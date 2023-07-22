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
      * @param chunk interleaved PCM data in signed 16bits int
      */
    processChunk(chunk) {
        if (!speexModule) {
            throw new Error('You need to wait for SpeexResampler.initPromise before calling this method');
        }
        // We check that we have as many chunks for each channel and that the last chunk is full (2 bytes)
        if (chunk.length % (this.channels * Uint16Array.BYTES_PER_ELEMENT) !== 0) {
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
        speexModule.setValue(this._inLengthPtr, chunk.length / this.channels / Uint16Array.BYTES_PER_ELEMENT, 'i32');
        // Copying the info from the input Buffer in the WASM memory space
        speexModule.HEAPU8.set(chunk, this._inBufferPtr);
        // number of samples per channels available in output buffer
        speexModule.setValue(this._outLengthPtr, this._outBufferSize / this.channels / Uint16Array.BYTES_PER_ELEMENT, 'i32');
        const errNum = speexModule._speex_resampler_process_interleaved_int(this._resamplerPtr, this._inBufferPtr, this._inLengthPtr, this._outBufferPtr, this._outLengthPtr);
        if (errNum !== 0) {
            throw new Error(speexModule.AsciiToString(speexModule._speex_resampler_strerror(errNum)));
        }
        const outSamplesPerChannelsWritten = speexModule.getValue(this._outLengthPtr, 'i32');
        // we are copying the info in a new buffer here, we could just pass a buffer pointing to the same memory space if needed
        return buffer_1.Buffer.from(speexModule.HEAPU8.slice(this._outBufferPtr, this._outBufferPtr + outSamplesPerChannelsWritten * this.channels * Uint16Array.BYTES_PER_ELEMENT).buffer);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiLyIsInNvdXJjZXMiOlsiaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBLG9DQUFvQzs7Ozs7O0FBRXBDLG1DQUFtQztBQUNuQyw4REFBcUM7QUFDckMsbUNBQStCO0FBYy9CLElBQUksV0FBd0MsQ0FBQztBQUM3QyxJQUFJLG1CQUFtQixHQUFHLG9CQUFTLEVBQUUsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDLFdBQVcsR0FBRyxDQUFDLENBQUMsQ0FBQztBQUVuRSxNQUFNLGNBQWM7SUFZbEI7Ozs7OztRQU1JO0lBQ0osWUFDUyxRQUFRLEVBQ1IsTUFBTSxFQUNOLE9BQU8sRUFDUCxVQUFVLENBQUM7UUFIWCxhQUFRLEdBQVIsUUFBUSxDQUFBO1FBQ1IsV0FBTSxHQUFOLE1BQU0sQ0FBQTtRQUNOLFlBQU8sR0FBUCxPQUFPLENBQUE7UUFDUCxZQUFPLEdBQVAsT0FBTyxDQUFJO1FBckJwQixpQkFBWSxHQUFHLENBQUMsQ0FBQyxDQUFDO1FBQ2xCLGtCQUFhLEdBQUcsQ0FBQyxDQUFDLENBQUM7UUFDbkIsa0JBQWEsR0FBRyxDQUFDLENBQUMsQ0FBQztRQUNuQixtQkFBYyxHQUFHLENBQUMsQ0FBQyxDQUFDO1FBRXBCLGlCQUFZLEdBQUcsQ0FBQyxDQUFDLENBQUM7UUFDbEIsa0JBQWEsR0FBRyxDQUFDLENBQUMsQ0FBQztJQWVJLENBQUM7SUFFeEI7OztRQUdJO0lBQ0osWUFBWSxDQUFDLEtBQWE7UUFDeEIsSUFBSSxDQUFDLFdBQVcsRUFBRTtZQUNoQixNQUFNLElBQUksS0FBSyxDQUFDLDRFQUE0RSxDQUFDLENBQUM7U0FDL0Y7UUFDRCxrR0FBa0c7UUFDbEcsSUFBSSxLQUFLLENBQUMsTUFBTSxHQUFHLENBQUMsSUFBSSxDQUFDLFFBQVEsR0FBRyxXQUFXLENBQUMsaUJBQWlCLENBQUMsS0FBSyxDQUFDLEVBQUU7WUFDeEUsTUFBTSxJQUFJLEtBQUssQ0FBQyx5REFB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LElBQUksY0FBYyxHQUFXLEtBQUssQ0FBQztRQUNuQyxJQUFJLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFO1lBQ3JDLGNBQWMsR0FBRyxlQUFNLENBQUMsTUFBTSxDQUFDO2dCQUM3QixJQUFJLENBQUMsaUJBQWlCO2dCQUN0QixLQUFLO2FBQ04sQ0FBQyxDQUFDO1lBQ0gsSUFBSSxDQUFDLGlCQUFpQixHQUFHLFlBQVksQ0FBQztTQUN2QztRQUNELHNFQUFzRTtRQUN0RSw2REFBNkQ7UUFDN0QsTUFBTSxvQkFBb0IsR0FBRyxjQUFjLENBQUMsTUFBTSxHQUFHLENBQUMsSUFBSSxDQUFDLFFBQVEsR0FBRyxXQUFXLENBQUMsaUJBQWlCLENBQUMsQ0FBQztRQUNyRyxJQUFJLG9CQUFvQixLQUFLLENBQUMsRUFBRTtZQUM5QixJQUFJLENBQUMsaUJBQWlCLEdBQUcsZUFBTSxDQUFDLElBQUksQ0FBQyxjQUFjLENBQUMsS0FBSyxDQUFDLGNBQWMsQ0FBQyxNQUFNLEdBQUcsb0JBQW9CLENBQUMsQ0FBQyxDQUFDO1lBQ3pHLGNBQWMsR0FBRyxjQUFjLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxjQUFjLENBQUMsTUFBTSxHQUFHLG9CQUFvQixDQUFDLENBQUM7U0FDeEY7UUFDRCxJQUFJO1lBQ0YsTUFBTSxHQUFHLEdBQUcsSUFBSSxDQUFDLFNBQVMsQ0FBQyxZQUFZLENBQUMsY0FBYyxDQUFDLENBQUM7WUFDeEQsUUFBUSxDQUFDLElBQUksRUFBRSxHQUFHLENBQUMsQ0FBQztTQUNyQjtRQUFDLE9BQU8sQ0FBQyxFQUFFO1lBQ1YsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDO1NBQ2I7SUFDSCxDQUFDO0NBQ0Y7QUF6Q0QsMERBeUNDO0FBRUQsa0JBQWUsY0FBYyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLy8vIDxyZWZlcmVuY2UgdHlwZXM9XCJlbXNjcmlwdGVuXCIgLz5cblxuaW1wb3J0IHsgVHJhbnNmb3JtIH0gZnJvbSAnc3RyZWFtJztcbmltcG9ydCBTcGVleFdhc20gZnJvbSAnLi9zcGVleF93YXNtJztcbmltcG9ydCB7IEJ1ZmZlciB9IGZyb20gJ2J1ZmZlcidcblxuaW50ZXJmYWNlIEVtc2NyaXB0ZW5Nb2R1bGVPcHVzRW5jb2RlciBleHRlbmRzIEVtc2NyaXB0ZW5Nb2R1bGUge1xuICBfc3BlZXhfcmVzYW1wbGVyX2luaXQobmJDaGFubmVsczogbnVtYmVyLCBpblJhdGU6IG51bWJlciwgb3V0UmF0ZTogbnVtYmVyLCBxdWFsaXR5OiBudW1iZXIsIGVyclBvaW50ZXI6IG51bWJlcik6IG51bWJlcjtcbiAgX3NwZWV4X3Jlc2FtcGxlcl9kZXN0cm95KHJlc2FtcGxlclB0cjogbnVtYmVyKTogdm9pZDtcbiAgX3NwZWV4X3Jlc2FtcGxlcl9nZXRfcmF0ZShyZXNhbXBsZXJQdHI6IG51bWJlciwgaW5SYXRlUHRyOiBudW1iZXIsIG91dFJhdGVQdHI6IG51bWJlcik7XG4gIF9zcGVleF9yZXNhbXBsZXJfcHJvY2Vzc19pbnRlcmxlYXZlZF9pbnQocmVzYW1wbGVyUHRyOiBudW1iZXIsIGluQnVmZmVyUHRyOiBudW1iZXIsIGluTGVuUHRyOiBudW1iZXIsIG91dEJ1ZmZlclB0cjogbnVtYmVyLCBvdXRMZW5QdHI6IG51bWJlcik6IG51bWJlcjtcbiAgX3NwZWV4X3Jlc2FtcGxlcl9zdHJlcnJvcihlcnI6IG51bWJlcik6IG51bWJlcjtcblxuICBnZXRWYWx1ZShwdHI6IG51bWJlciwgdHlwZTogc3RyaW5nKTogYW55O1xuICBzZXRWYWx1ZShwdHI6IG51bWJlciwgdmFsdWU6IGFueSwgdHlwZTogc3RyaW5nKTogYW55O1xuICBBc2NpaVRvU3RyaW5nKHB0cjogbnVtYmVyKTogc3RyaW5nO1xufVxuXG5sZXQgc3BlZXhNb2R1bGU6IEVtc2NyaXB0ZW5Nb2R1bGVPcHVzRW5jb2RlcjtcbmxldCBnbG9iYWxNb2R1bGVQcm9taXNlID0gU3BlZXhXYXNtKCkudGhlbigocykgPT4gc3BlZXhNb2R1bGUgPSBzKTtcblxuY2xhc3MgU3BlZXhSZXNhbXBsZXIge1xuICBfcmVzYW1wbGVyUHRyOiBudW1iZXI7XG4gIF9pbkJ1ZmZlclB0ciA9IC0xO1xuICBfaW5CdWZmZXJTaXplID0gLTE7XG4gIF9vdXRCdWZmZXJQdHIgPSAtMTtcbiAgX291dEJ1ZmZlclNpemUgPSAtMTtcblxuICBfaW5MZW5ndGhQdHIgPSAtMTtcbiAgX291dExlbmd0aFB0ciA9IC0xO1xuXG4gIHN0YXRpYyBpbml0UHJvbWlzZSA9IGdsb2JhbE1vZHVsZVByb21pc2UgYXMgUHJvbWlzZTxhbnk+O1xuXG4gIC8qKlxuICAgICogQ3JlYXRlIGFuIFNwZWV4UmVzYW1wbGVyIHRyYW5mb3JtIHN0cmVhbS5cbiAgICAqIEBwYXJhbSBjaGFubmVscyBOdW1iZXIgb2YgY2hhbm5lbHMsIG1pbmltdW0gaXMgMSwgbm8gbWF4aW11bVxuICAgICogQHBhcmFtIGluUmF0ZSBmcmVxdWVuY3kgaW4gSHogZm9yIHRoZSBpbnB1dCBjaHVua1xuICAgICogQHBhcmFtIG91dFJhdGUgZnJlcXVlbmN5IGluIEh6IGZvciB0aGUgdGFyZ2V0IGNodW5rXG4gICAgKiBAcGFyYW0gcXVhbGl0eSBudW1iZXIgZnJvbSAxIHRvIDEwLCBkZWZhdWx0IHRvIDcsIDEgaXMgZmFzdCBidXQgb2YgYmFkIHF1YWxpdHksIDEwIGlzIHNsb3cgYnV0IGJlc3QgcXVhbGl0eVxuICAgICovXG4gIGNvbnN0cnVjdG9yKFxuICAgIHB1YmxpYyBjaGFubmVscyxcbiAgICBwdWJsaWMgaW5SYXRlLFxuICAgIHB1YmxpYyBvdXRSYXRlLFxuICAgIHB1YmxpYyBxdWFsaXR5ID0gNykge31cblxuICAvKipcbiAgICAqIFJlc2FtcGxlIGEgY2h1bmsgb2YgYXVkaW8uXG4gICAgKiBAcGFyYW0gY2h1bmsgaW50ZXJsZWF2ZWQgUENNIGRhdGEgaW4gc2lnbmVkIDE2Yml0cyBpbnRcbiAgICAqL1xuICBwcm9jZXNzQ2h1bmsoY2h1bms6IEJ1ZmZlcikge1xuICAgIGlmICghc3BlZXhNb2R1bGUpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignWW91IG5lZWQgdG8gd2FpdCBmb3IgU3BlZXhSZXNhbXBsZXIuaW5pdFByb21pc2UgYmVmb3JlIGNhbGxpbmcgdGhpcyBtZXRob2QnKTtcbiAgICB9XG4gICAgLy8gV2UgY2hlY2sgdGhhdCB3ZSBoYXZlIGFzIG1hbnkgY2h1bmtzIGZvciBlYWNoIGNoYW5uZWwgYW5kIHRoYXQgdGhlIGxhc3QgY2h1bmsgaXMgZnVsbCAoMiBieXRlcylcbiAgICBpZiAoY2h1bmsubGVuZ3RoICUgKHRoaXMuY2hhbm5lbHMgKiBVaW50MTZBcnJheS5CWVRFU19QRVJfRUxFTUVOVCkgIT09IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignQ2h1bmsgbGVuZ3RoIHNob3VsZCBiZSBhIG11bHRpcGxlIG9mIGNoYW5uZWxzICogMiBieXRlcycpO1xuICAgIH1cblxuICAgIGlmICghdGhpcy5fcmVzYW1wbGVyUHRyKSB7XG4gICAgICBjb25zdCBlcnJQdHIgPSBzcGVleE1vZHVsZS5fbWFsbG9jKDQpO1xuICAgICAgdGhpcy5fcmVzYW1wbGVyUHRyID0gc3BlZXhNb2R1bGUuX3NwZWV4X3Jlc2FtcGxlcl9pbml0KHRoaXMuY2hhbm5lbHMsIHRoaXMuaW5SYXRlLCB0aGlzLm91dFJhdGUsIHRoaXMucXVhbGl0eSwgZXJyUHRyKTtcbiAgICAgIGNvbnN0IGVyck51bSA9IHNwZWV4TW9kdWxlLmdldFZhbHVlKGVyclB0ciwgJ2kzMicpO1xuICAgICAgaWYgKGVyck51bSAhPT0gMCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3Ioc3BlZXhNb2R1bGUuQXNjaWlUb1N0cmluZyhzcGVleE1vZHVsZS5fc3BlZXhfcmVzYW1wbGVyX3N0cmVycm9yKGVyck51bSkpKTtcbiAgICAgIH1cbiAgICAgIHRoaXMuX2luTGVuZ3RoUHRyID0gc3BlZXhNb2R1bGUuX21hbGxvYyhVaW50MzJBcnJheS5CWVRFU19QRVJfRUxFTUVOVCk7XG4gICAgICB0aGlzLl9vdXRMZW5ndGhQdHIgPSBzcGVleE1vZHVsZS5fbWFsbG9jKFVpbnQzMkFycmF5LkJZVEVTX1BFUl9FTEVNRU5UKTtcbiAgICB9XG5cbiAgICAvLyBSZXNpemluZyB0aGUgaW5wdXQgYnVmZmVyIGluIHRoZSBXQVNNIG1lbW9yeSBzcGFjZSB0byBtYXRjaCB3aGF0IHdlIG5lZWRcbiAgICBpZiAodGhpcy5faW5CdWZmZXJTaXplIDwgY2h1bmsubGVuZ3RoKSB7XG4gICAgICBpZiAodGhpcy5faW5CdWZmZXJQdHIgIT09IC0xKSB7XG4gICAgICAgIHNwZWV4TW9kdWxlLl9mcmVlKHRoaXMuX2luQnVmZmVyUHRyKTtcbiAgICAgIH1cbiAgICAgIHRoaXMuX2luQnVmZmVyUHRyID0gc3BlZXhNb2R1bGUuX21hbGxvYyhjaHVuay5sZW5ndGgpO1xuICAgICAgdGhpcy5faW5CdWZmZXJTaXplID0gY2h1bmsubGVuZ3RoO1xuICAgIH1cblxuICAgIC8vIFJlc2l6aW5nIHRoZSBvdXRwdXQgYnVmZmVyIGluIHRoZSBXQVNNIG1lbW9yeSBzcGFjZSB0byBtYXRjaCB3aGF0IHdlIG5lZWRcbiAgICBjb25zdCBvdXRCdWZmZXJMZW5ndGhUYXJnZXQgPSBNYXRoLmNlaWwoY2h1bmsubGVuZ3RoICogdGhpcy5vdXRSYXRlIC8gdGhpcy5pblJhdGUpO1xuICAgIGlmICh0aGlzLl9vdXRCdWZmZXJTaXplIDwgb3V0QnVmZmVyTGVuZ3RoVGFyZ2V0KSB7XG4gICAgICBpZiAodGhpcy5fb3V0QnVmZmVyUHRyICE9PSAtMSkge1xuICAgICAgICBzcGVleE1vZHVsZS5fZnJlZSh0aGlzLl9vdXRCdWZmZXJQdHIpO1xuICAgICAgfVxuICAgICAgdGhpcy5fb3V0QnVmZmVyUHRyID0gc3BlZXhNb2R1bGUuX21hbGxvYyhvdXRCdWZmZXJMZW5ndGhUYXJnZXQpO1xuICAgICAgdGhpcy5fb3V0QnVmZmVyU2l6ZSA9IG91dEJ1ZmZlckxlbmd0aFRhcmdldDtcbiAgICB9XG5cbiAgICAvLyBudW1iZXIgb2Ygc2FtcGxlcyBwZXIgY2hhbm5lbCBpbiBpbnB1dCBidWZmZXJcbiAgICBzcGVleE1vZHVsZS5zZXRWYWx1ZSh0aGlzLl9pbkxlbmd0aFB0ciwgY2h1bmsubGVuZ3RoIC8gdGhpcy5jaGFubmVscyAvIFVpbnQxNkFycmF5LkJZVEVTX1BFUl9FTEVNRU5ULCAnaTMyJyk7XG4gICAgLy8gQ29weWluZyB0aGUgaW5mbyBmcm9tIHRoZSBpbnB1dCBCdWZmZXIgaW4gdGhlIFdBU00gbWVtb3J5IHNwYWNlXG4gICAgc3BlZXhNb2R1bGUuSEVBUFU4LnNldChjaHVuaywgdGhpcy5faW5CdWZmZXJQdHIpO1xuXG4gICAgLy8gbnVtYmVyIG9mIHNhbXBsZXMgcGVyIGNoYW5uZWxzIGF2YWlsYWJsZSBpbiBvdXRwdXQgYnVmZmVyXG4gICAgc3BlZXhNb2R1bGUuc2V0VmFsdWUodGhpcy5fb3V0TGVuZ3RoUHRyLCB0aGlzLl9vdXRCdWZmZXJTaXplIC8gdGhpcy5jaGFubmVscyAvIFVpbnQxNkFycmF5LkJZVEVTX1BFUl9FTEVNRU5ULCAnaTMyJyk7XG4gICAgY29uc3QgZXJyTnVtID0gc3BlZXhNb2R1bGUuX3NwZWV4X3Jlc2FtcGxlcl9wcm9jZXNzX2ludGVybGVhdmVkX2ludChcbiAgICAgIHRoaXMuX3Jlc2FtcGxlclB0cixcbiAgICAgIHRoaXMuX2luQnVmZmVyUHRyLFxuICAgICAgdGhpcy5faW5MZW5ndGhQdHIsXG4gICAgICB0aGlzLl9vdXRCdWZmZXJQdHIsXG4gICAgICB0aGlzLl9vdXRMZW5ndGhQdHIsXG4gICAgKTtcblxuICAgIGlmIChlcnJOdW0gIT09IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihzcGVleE1vZHVsZS5Bc2NpaVRvU3RyaW5nKHNwZWV4TW9kdWxlLl9zcGVleF9yZXNhbXBsZXJfc3RyZXJyb3IoZXJyTnVtKSkpO1xuICAgIH1cblxuICAgIGNvbnN0IG91dFNhbXBsZXNQZXJDaGFubmVsc1dyaXR0ZW4gPSBzcGVleE1vZHVsZS5nZXRWYWx1ZSh0aGlzLl9vdXRMZW5ndGhQdHIsICdpMzInKTtcblxuICAgIC8vIHdlIGFyZSBjb3B5aW5nIHRoZSBpbmZvIGluIGEgbmV3IGJ1ZmZlciBoZXJlLCB3ZSBjb3VsZCBqdXN0IHBhc3MgYSBidWZmZXIgcG9pbnRpbmcgdG8gdGhlIHNhbWUgbWVtb3J5IHNwYWNlIGlmIG5lZWRlZFxuICAgIHJldHVybiBCdWZmZXIuZnJvbShcbiAgICAgIHNwZWV4TW9kdWxlLkhFQVBVOC5zbGljZShcbiAgICAgICAgdGhpcy5fb3V0QnVmZmVyUHRyLFxuICAgICAgICB0aGlzLl9vdXRCdWZmZXJQdHIgKyBvdXRTYW1wbGVzUGVyQ2hhbm5lbHNXcml0dGVuICogdGhpcy5jaGFubmVscyAqIFVpbnQxNkFycmF5LkJZVEVTX1BFUl9FTEVNRU5UXG4gICAgICApLmJ1ZmZlcik7XG4gIH1cbn1cblxuY29uc3QgRU1QVFlfQlVGRkVSID0gQnVmZmVyLmFsbG9jKDApO1xuXG5leHBvcnQgY2xhc3MgU3BlZXhSZXNhbXBsZXJUcmFuc2Zvcm0gZXh0ZW5kcyBUcmFuc2Zvcm0ge1xuICByZXNhbXBsZXI6IFNwZWV4UmVzYW1wbGVyO1xuICBfYWxpZ25lbWVudEJ1ZmZlcjogQnVmZmVyO1xuXG4gIC8qKlxuICAgICogQ3JlYXRlIGFuIFNwZWV4UmVzYW1wbGVyIGluc3RhbmNlLlxuICAgICogQHBhcmFtIGNoYW5uZWxzIE51bWJlciBvZiBjaGFubmVscywgbWluaW11bSBpcyAxLCBubyBtYXhpbXVtXG4gICAgKiBAcGFyYW0gaW5SYXRlIGZyZXF1ZW5jeSBpbiBIeiBmb3IgdGhlIGlucHV0IGNodW5rXG4gICAgKiBAcGFyYW0gb3V0UmF0ZSBmcmVxdWVuY3kgaW4gSHogZm9yIHRoZSB0YXJnZXQgY2h1bmtcbiAgICAqIEBwYXJhbSBxdWFsaXR5IG51bWJlciBmcm9tIDEgdG8gMTAsIGRlZmF1bHQgdG8gNywgMSBpcyBmYXN0IGJ1dCBvZiBiYWQgcXVhbGl0eSwgMTAgaXMgc2xvdyBidXQgYmVzdCBxdWFsaXR5XG4gICAgKi9cbiAgY29uc3RydWN0b3IocHVibGljIGNoYW5uZWxzLCBwdWJsaWMgaW5SYXRlLCBwdWJsaWMgb3V0UmF0ZSwgcHVibGljIHF1YWxpdHkgPSA3KSB7XG4gICAgc3VwZXIoKTtcbiAgICB0aGlzLnJlc2FtcGxlciA9IG5ldyBTcGVleFJlc2FtcGxlcihjaGFubmVscywgaW5SYXRlLCBvdXRSYXRlLCBxdWFsaXR5KTtcbiAgICB0aGlzLmNoYW5uZWxzID0gY2hhbm5lbHM7XG4gICAgdGhpcy5fYWxpZ25lbWVudEJ1ZmZlciA9IEVNUFRZX0JVRkZFUjtcbiAgfVxuXG4gIF90cmFuc2Zvcm0oY2h1bmssIGVuY29kaW5nLCBjYWxsYmFjaykge1xuICAgIGxldCBjaHVua1RvUHJvY2VzczogQnVmZmVyID0gY2h1bms7XG4gICAgaWYgKHRoaXMuX2FsaWduZW1lbnRCdWZmZXIubGVuZ3RoID4gMCkge1xuICAgICAgY2h1bmtUb1Byb2Nlc3MgPSBCdWZmZXIuY29uY2F0KFtcbiAgICAgICAgdGhpcy5fYWxpZ25lbWVudEJ1ZmZlcixcbiAgICAgICAgY2h1bmssXG4gICAgICBdKTtcbiAgICAgIHRoaXMuX2FsaWduZW1lbnRCdWZmZXIgPSBFTVBUWV9CVUZGRVI7XG4gICAgfVxuICAgIC8vIFNwZWV4IG5lZWRzIGEgYnVmZmVyIGFsaWduZWQgdG8gMTZiaXRzIHRpbWVzIHRoZSBudW1iZXIgb2YgY2hhbm5lbHNcbiAgICAvLyBzbyB3ZSBrZWVwIHRoZSBleHRyYW5lb3VzIGJ5dGVzIGluIGEgYnVmZmVyIGZvciBuZXh0IGNodW5rXG4gICAgY29uc3QgZXh0cmFuZW91c0J5dGVzQ291bnQgPSBjaHVua1RvUHJvY2Vzcy5sZW5ndGggJSAodGhpcy5jaGFubmVscyAqIFVpbnQxNkFycmF5LkJZVEVTX1BFUl9FTEVNRU5UKTtcbiAgICBpZiAoZXh0cmFuZW91c0J5dGVzQ291bnQgIT09IDApIHtcbiAgICAgIHRoaXMuX2FsaWduZW1lbnRCdWZmZXIgPSBCdWZmZXIuZnJvbShjaHVua1RvUHJvY2Vzcy5zbGljZShjaHVua1RvUHJvY2Vzcy5sZW5ndGggLSBleHRyYW5lb3VzQnl0ZXNDb3VudCkpO1xuICAgICAgY2h1bmtUb1Byb2Nlc3MgPSBjaHVua1RvUHJvY2Vzcy5zbGljZSgwLCBjaHVua1RvUHJvY2Vzcy5sZW5ndGggLSBleHRyYW5lb3VzQnl0ZXNDb3VudCk7XG4gICAgfVxuICAgIHRyeSB7XG4gICAgICBjb25zdCByZXMgPSB0aGlzLnJlc2FtcGxlci5wcm9jZXNzQ2h1bmsoY2h1bmtUb1Byb2Nlc3MpO1xuICAgICAgY2FsbGJhY2sobnVsbCwgcmVzKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBjYWxsYmFjayhlKTtcbiAgICB9XG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgU3BlZXhSZXNhbXBsZXI7XG4iXX0=