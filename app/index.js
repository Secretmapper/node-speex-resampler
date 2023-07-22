"use strict";
/// <reference types="emscripten" />
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpeexResamplerTransform = void 0;
const stream_1 = require("stream");
const speex_wasm_1 = __importDefault(require("./speex_wasm"));
const buffer_1 = require("buffer");
let speexModule;
let globalModulePromise = speex_wasm_1.default().then((s) => speexModule = s);
class SpeexResampler {
    /**
      * Create an SpeexResampler tranform stream.
      * @param channels Number of channels, minimum is 1, no maximum
      * @param inRate frequency in Hz for the input chunk
      * @param outRate frequency in Hz for the target chunk
      * @param quality number from 1 to 10, default to 7, 1 is fast but of bad quality, 10 is slow but best quality
      */
    constructor(channels, inRate, outRate, quality = 7) {
        this.channels = channels;
        this.inRate = inRate;
        this.outRate = outRate;
        this.quality = quality;
        this._inBufferPtr = -1;
        this._inBufferSize = -1;
        this._outBufferPtr = -1;
        this._outBufferSize = -1;
        this._inLengthPtr = -1;
        this._outLengthPtr = -1;
    }
    /**
      * Resample a chunk of audio.
      * @param chunk interleaved PCM data in float32
      */
    processChunk(chunk) {
        if (!speexModule) {
            throw new Error('You need to wait for SpeexResampler.initPromise before calling this method');
        }
        // We check that we have as many chunks for each channel and that the last chunk is full (2 bytes)
        if (chunk.length % (this.channels * Float32Array.BYTES_PER_ELEMENT) !== 0) {
            throw new Error('Chunk length should be a multiple of channels * 2 bytes');
        }
        if (!this._resamplerPtr) {
            const errPtr = speexModule._malloc(4);
            this._resamplerPtr = speexModule._speex_resampler_init(this.channels, this.inRate, this.outRate, this.quality, errPtr);
            const errNum = speexModule.getValue(errPtr, 'i32');
            if (errNum !== 0) {
                throw new Error(speexModule.AsciiToString(speexModule._speex_resampler_strerror(errNum)));
            }
            this._inLengthPtr = speexModule._malloc(Uint32Array.BYTES_PER_ELEMENT);
            this._outLengthPtr = speexModule._malloc(Uint32Array.BYTES_PER_ELEMENT);
        }
        // Resizing the input buffer in the WASM memory space to match what we need
        if (this._inBufferSize < chunk.length) {
            if (this._inBufferPtr !== -1) {
                speexModule._free(this._inBufferPtr);
            }
            this._inBufferPtr = speexModule._malloc(chunk.length);
            this._inBufferSize = chunk.length;
        }
        // Resizing the output buffer in the WASM memory space to match what we need
        const outBufferLengthTarget = Math.ceil(chunk.length * this.outRate / this.inRate);
        if (this._outBufferSize < outBufferLengthTarget) {
            if (this._outBufferPtr !== -1) {
                speexModule._free(this._outBufferPtr);
            }
            this._outBufferPtr = speexModule._malloc(outBufferLengthTarget);
            this._outBufferSize = outBufferLengthTarget;
        }
        // number of samples per channel in input buffer
        speexModule.setValue(this._inLengthPtr, chunk.length / this.channels / Float32Array.BYTES_PER_ELEMENT, 'i32');
        // Copying the info from the input Buffer in the WASM memory space
        speexModule.HEAPU8.set(chunk, this._inBufferPtr);
        // number of samples per channels available in output buffer
        speexModule.setValue(this._outLengthPtr, this._outBufferSize / this.channels / Float32Array.BYTES_PER_ELEMENT, 'i32');
        const errNum = speexModule._speex_resampler_process_interleaved_float(this._resamplerPtr, this._inBufferPtr, this._inLengthPtr, this._outBufferPtr, this._outLengthPtr);
        if (errNum !== 0) {
            throw new Error(speexModule.AsciiToString(speexModule._speex_resampler_strerror(errNum)));
        }
        const outSamplesPerChannelsWritten = speexModule.getValue(this._outLengthPtr, 'i32');
        // we are copying the info in a new buffer here, we could just pass a buffer pointing to the same memory space if needed
        return buffer_1.Buffer.from(speexModule.HEAPU8.slice(this._outBufferPtr, this._outBufferPtr + outSamplesPerChannelsWritten * this.channels * Float32Array.BYTES_PER_ELEMENT).buffer);
    }
}
SpeexResampler.initPromise = globalModulePromise;
const EMPTY_BUFFER = buffer_1.Buffer.alloc(0);
class SpeexResamplerTransform extends stream_1.Transform {
    /**
      * Create an SpeexResampler instance.
      * @param channels Number of channels, minimum is 1, no maximum
      * @param inRate frequency in Hz for the input chunk
      * @param outRate frequency in Hz for the target chunk
      * @param quality number from 1 to 10, default to 7, 1 is fast but of bad quality, 10 is slow but best quality
      */
    constructor(channels, inRate, outRate, quality = 7) {
        super();
        this.channels = channels;
        this.inRate = inRate;
        this.outRate = outRate;
        this.quality = quality;
        this.resampler = new SpeexResampler(channels, inRate, outRate, quality);
        this.channels = channels;
        this._alignementBuffer = EMPTY_BUFFER;
    }
    _transform(chunk, encoding, callback) {
        let chunkToProcess = chunk;
        if (this._alignementBuffer.length > 0) {
            chunkToProcess = buffer_1.Buffer.concat([
                this._alignementBuffer,
                chunk,
            ]);
            this._alignementBuffer = EMPTY_BUFFER;
        }
        // Speex needs a buffer aligned to 16bits times the number of channels
        // so we keep the extraneous bytes in a buffer for next chunk
        const extraneousBytesCount = chunkToProcess.length % (this.channels * Uint16Array.BYTES_PER_ELEMENT);
        if (extraneousBytesCount !== 0) {
            this._alignementBuffer = buffer_1.Buffer.from(chunkToProcess.slice(chunkToProcess.length - extraneousBytesCount));
            chunkToProcess = chunkToProcess.slice(0, chunkToProcess.length - extraneousBytesCount);
        }
        try {
            const res = this.resampler.processChunk(chunkToProcess);
            callback(null, res);
        }
        catch (e) {
            callback(e);
        }
    }
}
exports.SpeexResamplerTransform = SpeexResamplerTransform;
exports.default = SpeexResampler;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiLyIsInNvdXJjZXMiOlsiaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBLG9DQUFvQzs7Ozs7O0FBRXBDLG1DQUFtQztBQUNuQyw4REFBcUM7QUFDckMsbUNBQStCO0FBZS9CLElBQUksV0FBd0MsQ0FBQztBQUM3QyxJQUFJLG1CQUFtQixHQUFHLG9CQUFTLEVBQUUsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDLFdBQVcsR0FBRyxDQUFDLENBQUMsQ0FBQztBQUVuRSxNQUFNLGNBQWM7SUFZbEI7Ozs7OztRQU1JO0lBQ0osWUFDUyxRQUFRLEVBQ1IsTUFBTSxFQUNOLE9BQU8sRUFDUCxVQUFVLENBQUM7UUFIWCxhQUFRLEdBQVIsUUFBUSxDQUFBO1FBQ1IsV0FBTSxHQUFOLE1BQU0sQ0FBQTtRQUNOLFlBQU8sR0FBUCxPQUFPLENBQUE7UUFDUCxZQUFPLEdBQVAsT0FBTyxDQUFJO1FBckJwQixpQkFBWSxHQUFHLENBQUMsQ0FBQyxDQUFDO1FBQ2xCLGtCQUFhLEdBQUcsQ0FBQyxDQUFDLENBQUM7UUFDbkIsa0JBQWEsR0FBRyxDQUFDLENBQUMsQ0FBQztRQUNuQixtQkFBYyxHQUFHLENBQUMsQ0FBQyxDQUFDO1FBRXBCLGlCQUFZLEdBQUcsQ0FBQyxDQUFDLENBQUM7UUFDbEIsa0JBQWEsR0FBRyxDQUFDLENBQUMsQ0FBQztJQWVJLENBQUM7SUFFeEI7OztRQUdJO0lBQ0osWUFBWSxDQUFDLEtBQWE7UUFDeEIsSUFBSSxDQUFDLFdBQVcsRUFBRTtZQUNoQixNQUFNLElBQUksS0FBSyxDQUFDLDRFQUE0RSxDQUFDLENBQUM7U0FDL0Y7UUFDRCxrR0FBa0c7UUFDbEcsSUFBSSxLQUFLLENBQUMsTUFBTSxHQUFHLENBQUMsSUFBSSxDQUFDLFFBQVEsR0FBRyxZQUFZLENBQUMsaUJBQWlCLENBQUMsS0FBSyxDQUFDLEVBQUU7WUFDekUsTUFBTSxJQUFJLEtBQUssQ0FBQyx5REFB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LElBQUksY0FBYyxHQUFXLEtBQUssQ0FBQztRQUNuQyxJQUFJLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFO1lBQ3JDLGNBQWMsR0FBRyxlQUFNLENBQUMsTUFBTSxDQUFDO2dCQUM3QixJQUFJLENBQUMsaUJBQWlCO2dCQUN0QixLQUFLO2FBQ04sQ0FBQyxDQUFDO1lBQ0gsSUFBSSxDQUFDLGlCQUFpQixHQUFHLFlBQVksQ0FBQztTQUN2QztRQUNELHNFQUFzRTtRQUN0RSw2REFBNkQ7UUFDN0QsTUFBTSxvQkFBb0IsR0FBRyxjQUFjLENBQUMsTUFBTSxHQUFHLENBQUMsSUFBSSxDQUFDLFFBQVEsR0FBRyxXQUFXLENBQUMsaUJBQWlCLENBQUMsQ0FBQztRQUNyRyxJQUFJLG9CQUFvQixLQUFLLENBQUMsRUFBRTtZQUM5QixJQUFJLENBQUMsaUJBQWlCLEdBQUcsZUFBTSxDQUFDLElBQUksQ0FBQyxjQUFjLENBQUMsS0FBSyxDQUFDLGNBQWMsQ0FBQyxNQUFNLEdBQUcsb0JBQW9CLENBQUMsQ0FBQyxDQUFDO1lBQ3pHLGNBQWMsR0FBRyxjQUFjLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxjQUFjLENBQUMsTUFBTSxHQUFHLG9CQUFvQixDQUFDLENBQUM7U0FDeEY7UUFDRCxJQUFJO1lBQ0YsTUFBTSxHQUFHLEdBQUcsSUFBSSxDQUFDLFNBQVMsQ0FBQyxZQUFZLENBQUMsY0FBYyxDQUFDLENBQUM7WUFDeEQsUUFBUSxDQUFDLElBQUksRUFBRSxHQUFHLENBQUMsQ0FBQztTQUNyQjtRQUFDLE9BQU8sQ0FBQyxFQUFFO1lBQ1YsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDO1NBQ2I7SUFDSCxDQUFDO0NBQ0Y7QUF6Q0QsMERBeUNDO0FBRUQsa0JBQWUsY0FBYyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLy8vIDxyZWZlcmVuY2UgdHlwZXM9XCJlbXNjcmlwdGVuXCIgLz5cblxuaW1wb3J0IHsgVHJhbnNmb3JtIH0gZnJvbSAnc3RyZWFtJztcbmltcG9ydCBTcGVleFdhc20gZnJvbSAnLi9zcGVleF93YXNtJztcbmltcG9ydCB7IEJ1ZmZlciB9IGZyb20gJ2J1ZmZlcidcblxuaW50ZXJmYWNlIEVtc2NyaXB0ZW5Nb2R1bGVPcHVzRW5jb2RlciBleHRlbmRzIEVtc2NyaXB0ZW5Nb2R1bGUge1xuICBfc3BlZXhfcmVzYW1wbGVyX2luaXQobmJDaGFubmVsczogbnVtYmVyLCBpblJhdGU6IG51bWJlciwgb3V0UmF0ZTogbnVtYmVyLCBxdWFsaXR5OiBudW1iZXIsIGVyclBvaW50ZXI6IG51bWJlcik6IG51bWJlcjtcbiAgX3NwZWV4X3Jlc2FtcGxlcl9kZXN0cm95KHJlc2FtcGxlclB0cjogbnVtYmVyKTogdm9pZDtcbiAgX3NwZWV4X3Jlc2FtcGxlcl9nZXRfcmF0ZShyZXNhbXBsZXJQdHI6IG51bWJlciwgaW5SYXRlUHRyOiBudW1iZXIsIG91dFJhdGVQdHI6IG51bWJlcik7XG4gIF9zcGVleF9yZXNhbXBsZXJfcHJvY2Vzc19pbnRlcmxlYXZlZF9pbnQocmVzYW1wbGVyUHRyOiBudW1iZXIsIGluQnVmZmVyUHRyOiBudW1iZXIsIGluTGVuUHRyOiBudW1iZXIsIG91dEJ1ZmZlclB0cjogbnVtYmVyLCBvdXRMZW5QdHI6IG51bWJlcik6IG51bWJlcjtcbiAgX3NwZWV4X3Jlc2FtcGxlcl9wcm9jZXNzX2ludGVybGVhdmVkX2Zsb2F0KHJlc2FtcGxlclB0cjogbnVtYmVyLCBpbkJ1ZmZlclB0cjogbnVtYmVyLCBpbkxlblB0cjogbnVtYmVyLCBvdXRCdWZmZXJQdHI6IG51bWJlciwgb3V0TGVuUHRyOiBudW1iZXIpOiBudW1iZXI7XG4gIF9zcGVleF9yZXNhbXBsZXJfc3RyZXJyb3IoZXJyOiBudW1iZXIpOiBudW1iZXI7XG5cbiAgZ2V0VmFsdWUocHRyOiBudW1iZXIsIHR5cGU6IHN0cmluZyk6IGFueTtcbiAgc2V0VmFsdWUocHRyOiBudW1iZXIsIHZhbHVlOiBhbnksIHR5cGU6IHN0cmluZyk6IGFueTtcbiAgQXNjaWlUb1N0cmluZyhwdHI6IG51bWJlcik6IHN0cmluZztcbn1cblxubGV0IHNwZWV4TW9kdWxlOiBFbXNjcmlwdGVuTW9kdWxlT3B1c0VuY29kZXI7XG5sZXQgZ2xvYmFsTW9kdWxlUHJvbWlzZSA9IFNwZWV4V2FzbSgpLnRoZW4oKHMpID0+IHNwZWV4TW9kdWxlID0gcyk7XG5cbmNsYXNzIFNwZWV4UmVzYW1wbGVyIHtcbiAgX3Jlc2FtcGxlclB0cjogbnVtYmVyO1xuICBfaW5CdWZmZXJQdHIgPSAtMTtcbiAgX2luQnVmZmVyU2l6ZSA9IC0xO1xuICBfb3V0QnVmZmVyUHRyID0gLTE7XG4gIF9vdXRCdWZmZXJTaXplID0gLTE7XG5cbiAgX2luTGVuZ3RoUHRyID0gLTE7XG4gIF9vdXRMZW5ndGhQdHIgPSAtMTtcblxuICBzdGF0aWMgaW5pdFByb21pc2UgPSBnbG9iYWxNb2R1bGVQcm9taXNlIGFzIFByb21pc2U8YW55PjtcblxuICAvKipcbiAgICAqIENyZWF0ZSBhbiBTcGVleFJlc2FtcGxlciB0cmFuZm9ybSBzdHJlYW0uXG4gICAgKiBAcGFyYW0gY2hhbm5lbHMgTnVtYmVyIG9mIGNoYW5uZWxzLCBtaW5pbXVtIGlzIDEsIG5vIG1heGltdW1cbiAgICAqIEBwYXJhbSBpblJhdGUgZnJlcXVlbmN5IGluIEh6IGZvciB0aGUgaW5wdXQgY2h1bmtcbiAgICAqIEBwYXJhbSBvdXRSYXRlIGZyZXF1ZW5jeSBpbiBIeiBmb3IgdGhlIHRhcmdldCBjaHVua1xuICAgICogQHBhcmFtIHF1YWxpdHkgbnVtYmVyIGZyb20gMSB0byAxMCwgZGVmYXVsdCB0byA3LCAxIGlzIGZhc3QgYnV0IG9mIGJhZCBxdWFsaXR5LCAxMCBpcyBzbG93IGJ1dCBiZXN0IHF1YWxpdHlcbiAgICAqL1xuICBjb25zdHJ1Y3RvcihcbiAgICBwdWJsaWMgY2hhbm5lbHMsXG4gICAgcHVibGljIGluUmF0ZSxcbiAgICBwdWJsaWMgb3V0UmF0ZSxcbiAgICBwdWJsaWMgcXVhbGl0eSA9IDcpIHt9XG5cbiAgLyoqXG4gICAgKiBSZXNhbXBsZSBhIGNodW5rIG9mIGF1ZGlvLlxuICAgICogQHBhcmFtIGNodW5rIGludGVybGVhdmVkIFBDTSBkYXRhIGluIGZsb2F0MzJcbiAgICAqL1xuICBwcm9jZXNzQ2h1bmsoY2h1bms6IEJ1ZmZlcikge1xuICAgIGlmICghc3BlZXhNb2R1bGUpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignWW91IG5lZWQgdG8gd2FpdCBmb3IgU3BlZXhSZXNhbXBsZXIuaW5pdFByb21pc2UgYmVmb3JlIGNhbGxpbmcgdGhpcyBtZXRob2QnKTtcbiAgICB9XG4gICAgLy8gV2UgY2hlY2sgdGhhdCB3ZSBoYXZlIGFzIG1hbnkgY2h1bmtzIGZvciBlYWNoIGNoYW5uZWwgYW5kIHRoYXQgdGhlIGxhc3QgY2h1bmsgaXMgZnVsbCAoMiBieXRlcylcbiAgICBpZiAoY2h1bmsubGVuZ3RoICUgKHRoaXMuY2hhbm5lbHMgKiBGbG9hdDMyQXJyYXkuQllURVNfUEVSX0VMRU1FTlQpICE9PSAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0NodW5rIGxlbmd0aCBzaG91bGQgYmUgYSBtdWx0aXBsZSBvZiBjaGFubmVscyAqIDIgYnl0ZXMnKTtcbiAgICB9XG5cbiAgICBpZiAoIXRoaXMuX3Jlc2FtcGxlclB0cikge1xuICAgICAgY29uc3QgZXJyUHRyID0gc3BlZXhNb2R1bGUuX21hbGxvYyg0KTtcbiAgICAgIHRoaXMuX3Jlc2FtcGxlclB0ciA9IHNwZWV4TW9kdWxlLl9zcGVleF9yZXNhbXBsZXJfaW5pdCh0aGlzLmNoYW5uZWxzLCB0aGlzLmluUmF0ZSwgdGhpcy5vdXRSYXRlLCB0aGlzLnF1YWxpdHksIGVyclB0cik7XG4gICAgICBjb25zdCBlcnJOdW0gPSBzcGVleE1vZHVsZS5nZXRWYWx1ZShlcnJQdHIsICdpMzInKTtcbiAgICAgIGlmIChlcnJOdW0gIT09IDApIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKHNwZWV4TW9kdWxlLkFzY2lpVG9TdHJpbmcoc3BlZXhNb2R1bGUuX3NwZWV4X3Jlc2FtcGxlcl9zdHJlcnJvcihlcnJOdW0pKSk7XG4gICAgICB9XG4gICAgICB0aGlzLl9pbkxlbmd0aFB0ciA9IHNwZWV4TW9kdWxlLl9tYWxsb2MoVWludDMyQXJyYXkuQllURVNfUEVSX0VMRU1FTlQpO1xuICAgICAgdGhpcy5fb3V0TGVuZ3RoUHRyID0gc3BlZXhNb2R1bGUuX21hbGxvYyhVaW50MzJBcnJheS5CWVRFU19QRVJfRUxFTUVOVCk7XG4gICAgfVxuXG4gICAgLy8gUmVzaXppbmcgdGhlIGlucHV0IGJ1ZmZlciBpbiB0aGUgV0FTTSBtZW1vcnkgc3BhY2UgdG8gbWF0Y2ggd2hhdCB3ZSBuZWVkXG4gICAgaWYgKHRoaXMuX2luQnVmZmVyU2l6ZSA8IGNodW5rLmxlbmd0aCkge1xuICAgICAgaWYgKHRoaXMuX2luQnVmZmVyUHRyICE9PSAtMSkge1xuICAgICAgICBzcGVleE1vZHVsZS5fZnJlZSh0aGlzLl9pbkJ1ZmZlclB0cik7XG4gICAgICB9XG4gICAgICB0aGlzLl9pbkJ1ZmZlclB0ciA9IHNwZWV4TW9kdWxlLl9tYWxsb2MoY2h1bmsubGVuZ3RoKTtcbiAgICAgIHRoaXMuX2luQnVmZmVyU2l6ZSA9IGNodW5rLmxlbmd0aDtcbiAgICB9XG5cbiAgICAvLyBSZXNpemluZyB0aGUgb3V0cHV0IGJ1ZmZlciBpbiB0aGUgV0FTTSBtZW1vcnkgc3BhY2UgdG8gbWF0Y2ggd2hhdCB3ZSBuZWVkXG4gICAgY29uc3Qgb3V0QnVmZmVyTGVuZ3RoVGFyZ2V0ID0gTWF0aC5jZWlsKGNodW5rLmxlbmd0aCAqIHRoaXMub3V0UmF0ZSAvIHRoaXMuaW5SYXRlKTtcbiAgICBpZiAodGhpcy5fb3V0QnVmZmVyU2l6ZSA8IG91dEJ1ZmZlckxlbmd0aFRhcmdldCkge1xuICAgICAgaWYgKHRoaXMuX291dEJ1ZmZlclB0ciAhPT0gLTEpIHtcbiAgICAgICAgc3BlZXhNb2R1bGUuX2ZyZWUodGhpcy5fb3V0QnVmZmVyUHRyKTtcbiAgICAgIH1cbiAgICAgIHRoaXMuX291dEJ1ZmZlclB0ciA9IHNwZWV4TW9kdWxlLl9tYWxsb2Mob3V0QnVmZmVyTGVuZ3RoVGFyZ2V0KTtcbiAgICAgIHRoaXMuX291dEJ1ZmZlclNpemUgPSBvdXRCdWZmZXJMZW5ndGhUYXJnZXQ7XG4gICAgfVxuXG4gICAgLy8gbnVtYmVyIG9mIHNhbXBsZXMgcGVyIGNoYW5uZWwgaW4gaW5wdXQgYnVmZmVyXG4gICAgc3BlZXhNb2R1bGUuc2V0VmFsdWUodGhpcy5faW5MZW5ndGhQdHIsIGNodW5rLmxlbmd0aCAvIHRoaXMuY2hhbm5lbHMgLyBGbG9hdDMyQXJyYXkuQllURVNfUEVSX0VMRU1FTlQsICdpMzInKTtcbiAgICAvLyBDb3B5aW5nIHRoZSBpbmZvIGZyb20gdGhlIGlucHV0IEJ1ZmZlciBpbiB0aGUgV0FTTSBtZW1vcnkgc3BhY2VcbiAgICBzcGVleE1vZHVsZS5IRUFQVTguc2V0KGNodW5rLCB0aGlzLl9pbkJ1ZmZlclB0cik7XG5cbiAgICAvLyBudW1iZXIgb2Ygc2FtcGxlcyBwZXIgY2hhbm5lbHMgYXZhaWxhYmxlIGluIG91dHB1dCBidWZmZXJcbiAgICBzcGVleE1vZHVsZS5zZXRWYWx1ZSh0aGlzLl9vdXRMZW5ndGhQdHIsIHRoaXMuX291dEJ1ZmZlclNpemUgLyB0aGlzLmNoYW5uZWxzIC8gRmxvYXQzMkFycmF5LkJZVEVTX1BFUl9FTEVNRU5ULCAnaTMyJyk7XG4gICAgY29uc3QgZXJyTnVtID0gc3BlZXhNb2R1bGUuX3NwZWV4X3Jlc2FtcGxlcl9wcm9jZXNzX2ludGVybGVhdmVkX2Zsb2F0KFxuICAgICAgdGhpcy5fcmVzYW1wbGVyUHRyLFxuICAgICAgdGhpcy5faW5CdWZmZXJQdHIsXG4gICAgICB0aGlzLl9pbkxlbmd0aFB0cixcbiAgICAgIHRoaXMuX291dEJ1ZmZlclB0cixcbiAgICAgIHRoaXMuX291dExlbmd0aFB0cixcbiAgICApO1xuXG4gICAgaWYgKGVyck51bSAhPT0gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKHNwZWV4TW9kdWxlLkFzY2lpVG9TdHJpbmcoc3BlZXhNb2R1bGUuX3NwZWV4X3Jlc2FtcGxlcl9zdHJlcnJvcihlcnJOdW0pKSk7XG4gICAgfVxuXG4gICAgY29uc3Qgb3V0U2FtcGxlc1BlckNoYW5uZWxzV3JpdHRlbiA9IHNwZWV4TW9kdWxlLmdldFZhbHVlKHRoaXMuX291dExlbmd0aFB0ciwgJ2kzMicpO1xuXG4gICAgLy8gd2UgYXJlIGNvcHlpbmcgdGhlIGluZm8gaW4gYSBuZXcgYnVmZmVyIGhlcmUsIHdlIGNvdWxkIGp1c3QgcGFzcyBhIGJ1ZmZlciBwb2ludGluZyB0byB0aGUgc2FtZSBtZW1vcnkgc3BhY2UgaWYgbmVlZGVkXG4gICAgcmV0dXJuIEJ1ZmZlci5mcm9tKFxuICAgICAgc3BlZXhNb2R1bGUuSEVBUFU4LnNsaWNlKFxuICAgICAgICB0aGlzLl9vdXRCdWZmZXJQdHIsXG4gICAgICAgIHRoaXMuX291dEJ1ZmZlclB0ciArIG91dFNhbXBsZXNQZXJDaGFubmVsc1dyaXR0ZW4gKiB0aGlzLmNoYW5uZWxzICogRmxvYXQzMkFycmF5LkJZVEVTX1BFUl9FTEVNRU5UXG4gICAgICApLmJ1ZmZlcik7XG4gIH1cbn1cblxuY29uc3QgRU1QVFlfQlVGRkVSID0gQnVmZmVyLmFsbG9jKDApO1xuXG5leHBvcnQgY2xhc3MgU3BlZXhSZXNhbXBsZXJUcmFuc2Zvcm0gZXh0ZW5kcyBUcmFuc2Zvcm0ge1xuICByZXNhbXBsZXI6IFNwZWV4UmVzYW1wbGVyO1xuICBfYWxpZ25lbWVudEJ1ZmZlcjogQnVmZmVyO1xuXG4gIC8qKlxuICAgICogQ3JlYXRlIGFuIFNwZWV4UmVzYW1wbGVyIGluc3RhbmNlLlxuICAgICogQHBhcmFtIGNoYW5uZWxzIE51bWJlciBvZiBjaGFubmVscywgbWluaW11bSBpcyAxLCBubyBtYXhpbXVtXG4gICAgKiBAcGFyYW0gaW5SYXRlIGZyZXF1ZW5jeSBpbiBIeiBmb3IgdGhlIGlucHV0IGNodW5rXG4gICAgKiBAcGFyYW0gb3V0UmF0ZSBmcmVxdWVuY3kgaW4gSHogZm9yIHRoZSB0YXJnZXQgY2h1bmtcbiAgICAqIEBwYXJhbSBxdWFsaXR5IG51bWJlciBmcm9tIDEgdG8gMTAsIGRlZmF1bHQgdG8gNywgMSBpcyBmYXN0IGJ1dCBvZiBiYWQgcXVhbGl0eSwgMTAgaXMgc2xvdyBidXQgYmVzdCBxdWFsaXR5XG4gICAgKi9cbiAgY29uc3RydWN0b3IocHVibGljIGNoYW5uZWxzLCBwdWJsaWMgaW5SYXRlLCBwdWJsaWMgb3V0UmF0ZSwgcHVibGljIHF1YWxpdHkgPSA3KSB7XG4gICAgc3VwZXIoKTtcbiAgICB0aGlzLnJlc2FtcGxlciA9IG5ldyBTcGVleFJlc2FtcGxlcihjaGFubmVscywgaW5SYXRlLCBvdXRSYXRlLCBxdWFsaXR5KTtcbiAgICB0aGlzLmNoYW5uZWxzID0gY2hhbm5lbHM7XG4gICAgdGhpcy5fYWxpZ25lbWVudEJ1ZmZlciA9IEVNUFRZX0JVRkZFUjtcbiAgfVxuXG4gIF90cmFuc2Zvcm0oY2h1bmssIGVuY29kaW5nLCBjYWxsYmFjaykge1xuICAgIGxldCBjaHVua1RvUHJvY2VzczogQnVmZmVyID0gY2h1bms7XG4gICAgaWYgKHRoaXMuX2FsaWduZW1lbnRCdWZmZXIubGVuZ3RoID4gMCkge1xuICAgICAgY2h1bmtUb1Byb2Nlc3MgPSBCdWZmZXIuY29uY2F0KFtcbiAgICAgICAgdGhpcy5fYWxpZ25lbWVudEJ1ZmZlcixcbiAgICAgICAgY2h1bmssXG4gICAgICBdKTtcbiAgICAgIHRoaXMuX2FsaWduZW1lbnRCdWZmZXIgPSBFTVBUWV9CVUZGRVI7XG4gICAgfVxuICAgIC8vIFNwZWV4IG5lZWRzIGEgYnVmZmVyIGFsaWduZWQgdG8gMTZiaXRzIHRpbWVzIHRoZSBudW1iZXIgb2YgY2hhbm5lbHNcbiAgICAvLyBzbyB3ZSBrZWVwIHRoZSBleHRyYW5lb3VzIGJ5dGVzIGluIGEgYnVmZmVyIGZvciBuZXh0IGNodW5rXG4gICAgY29uc3QgZXh0cmFuZW91c0J5dGVzQ291bnQgPSBjaHVua1RvUHJvY2Vzcy5sZW5ndGggJSAodGhpcy5jaGFubmVscyAqIFVpbnQxNkFycmF5LkJZVEVTX1BFUl9FTEVNRU5UKTtcbiAgICBpZiAoZXh0cmFuZW91c0J5dGVzQ291bnQgIT09IDApIHtcbiAgICAgIHRoaXMuX2FsaWduZW1lbnRCdWZmZXIgPSBCdWZmZXIuZnJvbShjaHVua1RvUHJvY2Vzcy5zbGljZShjaHVua1RvUHJvY2Vzcy5sZW5ndGggLSBleHRyYW5lb3VzQnl0ZXNDb3VudCkpO1xuICAgICAgY2h1bmtUb1Byb2Nlc3MgPSBjaHVua1RvUHJvY2Vzcy5zbGljZSgwLCBjaHVua1RvUHJvY2Vzcy5sZW5ndGggLSBleHRyYW5lb3VzQnl0ZXNDb3VudCk7XG4gICAgfVxuICAgIHRyeSB7XG4gICAgICBjb25zdCByZXMgPSB0aGlzLnJlc2FtcGxlci5wcm9jZXNzQ2h1bmsoY2h1bmtUb1Byb2Nlc3MpO1xuICAgICAgY2FsbGJhY2sobnVsbCwgcmVzKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBjYWxsYmFjayhlKTtcbiAgICB9XG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgU3BlZXhSZXNhbXBsZXI7XG4iXX0=