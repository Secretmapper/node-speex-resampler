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
        Uint16Array.BYTES_PER_ELEMENT;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiLyIsInNvdXJjZXMiOlsiaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBLG9DQUFvQzs7Ozs7O0FBRXBDLG1DQUFtQztBQUNuQyw4REFBcUM7QUFDckMsbUNBQStCO0FBZS9CLElBQUksV0FBd0MsQ0FBQztBQUM3QyxJQUFJLG1CQUFtQixHQUFHLG9CQUFTLEVBQUUsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDLFdBQVcsR0FBRyxDQUFDLENBQUMsQ0FBQztBQUVuRSxNQUFNLGNBQWM7SUFZbEI7Ozs7OztRQU1JO0lBQ0osWUFDUyxRQUFRLEVBQ1IsTUFBTSxFQUNOLE9BQU8sRUFDUCxVQUFVLENBQUM7UUFIWCxhQUFRLEdBQVIsUUFBUSxDQUFBO1FBQ1IsV0FBTSxHQUFOLE1BQU0sQ0FBQTtRQUNOLFlBQU8sR0FBUCxPQUFPLENBQUE7UUFDUCxZQUFPLEdBQVAsT0FBTyxDQUFJO1FBckJwQixpQkFBWSxHQUFHLENBQUMsQ0FBQyxDQUFDO1FBQ2xCLGtCQUFhLEdBQUcsQ0FBQyxDQUFDLENBQUM7UUFDbkIsa0JBQWEsR0FBRyxDQUFDLENBQUMsQ0FBQztRQUNuQixtQkFBYyxHQUFHLENBQUMsQ0FBQyxDQUFDO1FBRXBCLGlCQUFZLEdBQUcsQ0FBQyxDQUFDLENBQUM7UUFDbEIsa0JBQWEsR0FBRyxDQUFDLENBQUMsQ0FBQztJQWVJLENBQUM7SUFFeEI7OztRQUdJO0lBQ0osWUFBWSxDQUFDLEtBQWE7UUFDeEIsSUFBSSxDQUFDLFdBQVcsRUFBRTtZQUNoQixNQUFNLElBQUksS0FBSyxDQUFDLDRFQUE0RSxDQUFDLENBQUM7U0FDL0Y7UUFDRCxXQUFXLENBQUMsaUJBQWlCLENBQUE7UUFDN0Isa0dBQWtHO1FBQ2xHLElBQUksS0FBSyxDQUFDLE1BQU0sR0FBRyxDQUFDLElBQUksQ0FBQyxRQUFRLEdBQUcsWUFBWSxDQUFDLGlCQUFpQixDQUFDLEtBQUssQ0FBQyxFQUFFO1lBQ3pFLE1BQU0sSUFBSSxLQUFLLENBQUMseURBQXlELENBQUMsQ0FBQztTQUM1RTtRQUVELElBQUksQ0FBQyxJQUFJLENBQUMsYUFBYSxFQUFFO1lBQ3ZCLE1BQU0sTUFBTSxHQUFHLFdBQVcsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDdEMsSUFBSSxDQUFDLGFBQWEsR0FBRyxXQUFXLENBQUMscUJBQXFCLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFBRSxJQUFJLENBQUMsTUFBTSxFQUFFLElBQUksQ0FBQyxPQUFPLEVBQUUsSUFBSSxDQUFDLE9BQU8sRUFBRSxNQUFNLENBQUMsQ0FBQztZQUN2SCxNQUFNLE1BQU0sR0FBRyxXQUFXLENBQUMsUUFBUSxDQUFDLE1BQU0sRUFBRSxLQUFLLENBQUMsQ0FBQztZQUNuRCxJQUFJLE1BQU0sS0FBSyxDQUFDLEVBQUU7Z0JBQ2hCLE1BQU0sSUFBSSxLQUFLLENBQUMsV0FBVyxDQUFDLGFBQWEsQ0FBQyxXQUFXLENBQUMseUJBQXlCLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDO2FBQzNGO1lBQ0QsSUFBSSxDQUFDLFlBQVksR0FBRyxXQUFXLENBQUMsT0FBTyxDQUFDLFdBQVcsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDO1lBQ3ZFLElBQUksQ0FBQyxhQUFhLEdBQUcsV0FBVyxDQUFDLE9BQU8sQ0FBQyxXQUFXLENBQUMsaUJBQWlCLENBQUMsQ0FBQztTQUN6RTtRQUVELDJFQUEyRTtRQUMzRSxJQUFJLElBQUksQ0FBQyxhQUFhLEdBQUcsS0FBSyxDQUFDLE1BQU0sRUFBRTtZQUNyQyxJQUFJLElBQUksQ0FBQyxZQUFZLEtBQUssQ0FBQyxDQUFDLEVBQUU7Z0JBQzVCLFdBQVcsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxDQUFDO2FBQ3RDO1lBQ0QsSUFBSSxDQUFDLFlBQVksR0FBRyxXQUFXLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsQ0FBQztZQUN0RCxJQUFJLENBQUMsYUFBYSxHQUFHLEtBQUssQ0FBQyxNQUFNLENBQUM7U0FDbkM7UUFFRCw0RUFBNEU7UUFDNUUsTUFBTSxxQkFBcUIsR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxNQUFNLEdBQUcsSUFBSSxDQUFDLE9BQU8sR0FBRyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUM7UUFDbkYsSUFBSSxJQUFJLENBQUMsY0FBYyxHQUFHLHFCQUFxQixFQUFFO1lBQy9DLElBQUksSUFBSSxDQUFDLGFBQWEsS0FBSyxDQUFDLENBQUMsRUFBRTtnQkFDN0IsV0FBVyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLENBQUM7YUFDdkM7WUFDRCxJQUFJLENBQUMsYUFBYSxHQUFHLFdBQVcsQ0FBQyxPQUFPLENBQUMscUJBQXFCLENBQUMsQ0FBQztZQUNoRSxJQUFJLENBQUMsY0FBYyxHQUFHLHFCQUFxQixDQUFDO1NBQzdDO1FBRUQsZ0RBQWdEO1FBQ2hELFdBQVcsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLFlBQVksRUFBRSxLQUFLLENBQUMsTUFBTSxHQUFHLElBQUksQ0FBQyxRQUFRLEdBQUcsWUFBWSxDQUFDLGlCQUFpQixFQUFFLEtBQUssQ0FBQyxDQUFDO1FBQzlHLGtFQUFrRTtRQUNsRSxXQUFXLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxLQUFLLEVBQUUsSUFBSSxDQUFDLFlBQVksQ0FBQyxDQUFDO1FBRWpELDREQUE0RDtRQUM1RCxXQUFXLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxhQUFhLEVBQUUsSUFBSSxDQUFDLGNBQWMsR0FBRyxJQUFJLENBQUMsUUFBUSxHQUFHLFlBQVksQ0FBQyxpQkFBaUIsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUN0SCxNQUFNLE1BQU0sR0FBRyxXQUFXLENBQUMsMENBQTBDLENBQ25FLElBQUksQ0FBQyxhQUFhLEVBQ2xCLElBQUksQ0FBQyxZQUFZLEVBQ2pCLElBQUksQ0FBQyxZQUFZLEVBQ2pCLElBQUksQ0FBQyxhQUFhLEVBQ2xCLElBQUksQ0FBQyxhQUFhLENBQ25CLENBQUM7UUFFRixJQUFJLE1BQU0sS0FBSyxDQUFDLEVBQUU7WUFDaEIsTUFBTSxJQUFJLEtBQUssQ0FBQyxXQUFXLENBQUMsYUFBYSxDQUFDLFdBQVcsQ0FBQyx5QkFBeUIsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUM7U0FDM0Y7UUFFRCxNQUFNLDRCQUE0QixHQUFHLFdBQVcsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLGFBQWEsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUVyRix3SEFBd0g7UUFDeEgsT0FBTyxlQUFNLENBQUMsSUFBSSxDQUNoQixXQUFXLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FDdEIsSUFBSSxDQUFDLGFBQWEsRUFDbEIsSUFBSSxDQUFDLGFBQWEsR0FBRyw0QkFBNEIsR0FBRyxJQUFJLENBQUMsUUFBUSxHQUFHLFlBQVksQ0FBQyxpQkFBaUIsQ0FDbkcsQ0FBQyxNQUFNLENBQUMsQ0FBQztJQUNkLENBQUM7O0FBdEZNLDBCQUFXLEdBQUcsbUJBQW1DLENBQUM7QUF5RjNELE1BQU0sWUFBWSxHQUFHLGVBQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUM7QUFFckMsTUFBYSx1QkFBd0IsU0FBUSxrQkFBUztJQUlwRDs7Ozs7O1FBTUk7SUFDSixZQUFtQixRQUFRLEVBQVMsTUFBTSxFQUFTLE9BQU8sRUFBUyxVQUFVLENBQUM7UUFDNUUsS0FBSyxFQUFFLENBQUM7UUFEUyxhQUFRLEdBQVIsUUFBUSxDQUFBO1FBQVMsV0FBTSxHQUFOLE1BQU0sQ0FBQTtRQUFTLFlBQU8sR0FBUCxPQUFPLENBQUE7UUFBUyxZQUFPLEdBQVAsT0FBTyxDQUFJO1FBRTVFLElBQUksQ0FBQyxTQUFTLEdBQUcsSUFBSSxjQUFjLENBQUMsUUFBUSxFQUFFLE1BQU0sRUFBRSxPQUFPLEVBQUUsT0FBTyxDQUFDLENBQUM7UUFDeEUsSUFBSSxDQUFDLFFBQVEsR0FBRyxRQUFRLENBQUM7UUFDekIsSUFBSSxDQUFDLGlCQUFpQixHQUFHLFlBQVksQ0FBQztJQUN4QyxDQUFDO0lBRUQsVUFBVSxDQUFDLEtBQUssRUFBRSxRQUFRLEVBQUUsUUFBUTtRQUNsQyxJQUFJLGNBQWMsR0FBVyxLQUFLLENBQUM7UUFDbkMsSUFBSSxJQUFJLENBQUMsaUJBQWlCLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRTtZQUNyQyxjQUFjLEdBQUcsZUFBTSxDQUFDLE1BQU0sQ0FBQztnQkFDN0IsSUFBSSxDQUFDLGlCQUFpQjtnQkFDdEIsS0FBSzthQUNOLENBQUMsQ0FBQztZQUNILElBQUksQ0FBQyxpQkFBaUIsR0FBRyxZQUFZLENBQUM7U0FDdkM7UUFDRCxzRUFBc0U7UUFDdEUsNkRBQTZEO1FBQzdELE1BQU0sb0JBQW9CLEdBQUcsY0FBYyxDQUFDLE1BQU0sR0FBRyxDQUFDLElBQUksQ0FBQyxRQUFRLEdBQUcsV0FBVyxDQUFDLGlCQUFpQixDQUFDLENBQUM7UUFDckcsSUFBSSxvQkFBb0IsS0FBSyxDQUFDLEVBQUU7WUFDOUIsSUFBSSxDQUFDLGlCQUFpQixHQUFHLGVBQU0sQ0FBQyxJQUFJLENBQUMsY0FBYyxDQUFDLEtBQUssQ0FBQyxjQUFjLENBQUMsTUFBTSxHQUFHLG9CQUFvQixDQUFDLENBQUMsQ0FBQztZQUN6RyxjQUFjLEdBQUcsY0FBYyxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUUsY0FBYyxDQUFDLE1BQU0sR0FBRyxvQkFBb0IsQ0FBQyxDQUFDO1NBQ3hGO1FBQ0QsSUFBSTtZQUNGLE1BQU0sR0FBRyxHQUFHLElBQUksQ0FBQyxTQUFTLENBQUMsWUFBWSxDQUFDLGNBQWMsQ0FBQyxDQUFDO1lBQ3hELFFBQVEsQ0FBQyxJQUFJLEVBQUUsR0FBRyxDQUFDLENBQUM7U0FDckI7UUFBQyxPQUFPLENBQUMsRUFBRTtZQUNWLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQztTQUNiO0lBQ0gsQ0FBQztDQUNGO0FBekNELDBEQXlDQztBQUVELGtCQUFlLGNBQWMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vLyA8cmVmZXJlbmNlIHR5cGVzPVwiZW1zY3JpcHRlblwiIC8+XG5cbmltcG9ydCB7IFRyYW5zZm9ybSB9IGZyb20gJ3N0cmVhbSc7XG5pbXBvcnQgU3BlZXhXYXNtIGZyb20gJy4vc3BlZXhfd2FzbSc7XG5pbXBvcnQgeyBCdWZmZXIgfSBmcm9tICdidWZmZXInXG5cbmludGVyZmFjZSBFbXNjcmlwdGVuTW9kdWxlT3B1c0VuY29kZXIgZXh0ZW5kcyBFbXNjcmlwdGVuTW9kdWxlIHtcbiAgX3NwZWV4X3Jlc2FtcGxlcl9pbml0KG5iQ2hhbm5lbHM6IG51bWJlciwgaW5SYXRlOiBudW1iZXIsIG91dFJhdGU6IG51bWJlciwgcXVhbGl0eTogbnVtYmVyLCBlcnJQb2ludGVyOiBudW1iZXIpOiBudW1iZXI7XG4gIF9zcGVleF9yZXNhbXBsZXJfZGVzdHJveShyZXNhbXBsZXJQdHI6IG51bWJlcik6IHZvaWQ7XG4gIF9zcGVleF9yZXNhbXBsZXJfZ2V0X3JhdGUocmVzYW1wbGVyUHRyOiBudW1iZXIsIGluUmF0ZVB0cjogbnVtYmVyLCBvdXRSYXRlUHRyOiBudW1iZXIpO1xuICBfc3BlZXhfcmVzYW1wbGVyX3Byb2Nlc3NfaW50ZXJsZWF2ZWRfaW50KHJlc2FtcGxlclB0cjogbnVtYmVyLCBpbkJ1ZmZlclB0cjogbnVtYmVyLCBpbkxlblB0cjogbnVtYmVyLCBvdXRCdWZmZXJQdHI6IG51bWJlciwgb3V0TGVuUHRyOiBudW1iZXIpOiBudW1iZXI7XG4gIF9zcGVleF9yZXNhbXBsZXJfcHJvY2Vzc19pbnRlcmxlYXZlZF9mbG9hdChyZXNhbXBsZXJQdHI6IG51bWJlciwgaW5CdWZmZXJQdHI6IG51bWJlciwgaW5MZW5QdHI6IG51bWJlciwgb3V0QnVmZmVyUHRyOiBudW1iZXIsIG91dExlblB0cjogbnVtYmVyKTogbnVtYmVyO1xuICBfc3BlZXhfcmVzYW1wbGVyX3N0cmVycm9yKGVycjogbnVtYmVyKTogbnVtYmVyO1xuXG4gIGdldFZhbHVlKHB0cjogbnVtYmVyLCB0eXBlOiBzdHJpbmcpOiBhbnk7XG4gIHNldFZhbHVlKHB0cjogbnVtYmVyLCB2YWx1ZTogYW55LCB0eXBlOiBzdHJpbmcpOiBhbnk7XG4gIEFzY2lpVG9TdHJpbmcocHRyOiBudW1iZXIpOiBzdHJpbmc7XG59XG5cbmxldCBzcGVleE1vZHVsZTogRW1zY3JpcHRlbk1vZHVsZU9wdXNFbmNvZGVyO1xubGV0IGdsb2JhbE1vZHVsZVByb21pc2UgPSBTcGVleFdhc20oKS50aGVuKChzKSA9PiBzcGVleE1vZHVsZSA9IHMpO1xuXG5jbGFzcyBTcGVleFJlc2FtcGxlciB7XG4gIF9yZXNhbXBsZXJQdHI6IG51bWJlcjtcbiAgX2luQnVmZmVyUHRyID0gLTE7XG4gIF9pbkJ1ZmZlclNpemUgPSAtMTtcbiAgX291dEJ1ZmZlclB0ciA9IC0xO1xuICBfb3V0QnVmZmVyU2l6ZSA9IC0xO1xuXG4gIF9pbkxlbmd0aFB0ciA9IC0xO1xuICBfb3V0TGVuZ3RoUHRyID0gLTE7XG5cbiAgc3RhdGljIGluaXRQcm9taXNlID0gZ2xvYmFsTW9kdWxlUHJvbWlzZSBhcyBQcm9taXNlPGFueT47XG5cbiAgLyoqXG4gICAgKiBDcmVhdGUgYW4gU3BlZXhSZXNhbXBsZXIgdHJhbmZvcm0gc3RyZWFtLlxuICAgICogQHBhcmFtIGNoYW5uZWxzIE51bWJlciBvZiBjaGFubmVscywgbWluaW11bSBpcyAxLCBubyBtYXhpbXVtXG4gICAgKiBAcGFyYW0gaW5SYXRlIGZyZXF1ZW5jeSBpbiBIeiBmb3IgdGhlIGlucHV0IGNodW5rXG4gICAgKiBAcGFyYW0gb3V0UmF0ZSBmcmVxdWVuY3kgaW4gSHogZm9yIHRoZSB0YXJnZXQgY2h1bmtcbiAgICAqIEBwYXJhbSBxdWFsaXR5IG51bWJlciBmcm9tIDEgdG8gMTAsIGRlZmF1bHQgdG8gNywgMSBpcyBmYXN0IGJ1dCBvZiBiYWQgcXVhbGl0eSwgMTAgaXMgc2xvdyBidXQgYmVzdCBxdWFsaXR5XG4gICAgKi9cbiAgY29uc3RydWN0b3IoXG4gICAgcHVibGljIGNoYW5uZWxzLFxuICAgIHB1YmxpYyBpblJhdGUsXG4gICAgcHVibGljIG91dFJhdGUsXG4gICAgcHVibGljIHF1YWxpdHkgPSA3KSB7fVxuXG4gIC8qKlxuICAgICogUmVzYW1wbGUgYSBjaHVuayBvZiBhdWRpby5cbiAgICAqIEBwYXJhbSBjaHVuayBpbnRlcmxlYXZlZCBQQ00gZGF0YSBpbiBmbG9hdDMyXG4gICAgKi9cbiAgcHJvY2Vzc0NodW5rKGNodW5rOiBCdWZmZXIpIHtcbiAgICBpZiAoIXNwZWV4TW9kdWxlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1lvdSBuZWVkIHRvIHdhaXQgZm9yIFNwZWV4UmVzYW1wbGVyLmluaXRQcm9taXNlIGJlZm9yZSBjYWxsaW5nIHRoaXMgbWV0aG9kJyk7XG4gICAgfVxuICAgIFVpbnQxNkFycmF5LkJZVEVTX1BFUl9FTEVNRU5UXG4gICAgLy8gV2UgY2hlY2sgdGhhdCB3ZSBoYXZlIGFzIG1hbnkgY2h1bmtzIGZvciBlYWNoIGNoYW5uZWwgYW5kIHRoYXQgdGhlIGxhc3QgY2h1bmsgaXMgZnVsbCAoMiBieXRlcylcbiAgICBpZiAoY2h1bmsubGVuZ3RoICUgKHRoaXMuY2hhbm5lbHMgKiBGbG9hdDMyQXJyYXkuQllURVNfUEVSX0VMRU1FTlQpICE9PSAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0NodW5rIGxlbmd0aCBzaG91bGQgYmUgYSBtdWx0aXBsZSBvZiBjaGFubmVscyAqIDIgYnl0ZXMnKTtcbiAgICB9XG5cbiAgICBpZiAoIXRoaXMuX3Jlc2FtcGxlclB0cikge1xuICAgICAgY29uc3QgZXJyUHRyID0gc3BlZXhNb2R1bGUuX21hbGxvYyg0KTtcbiAgICAgIHRoaXMuX3Jlc2FtcGxlclB0ciA9IHNwZWV4TW9kdWxlLl9zcGVleF9yZXNhbXBsZXJfaW5pdCh0aGlzLmNoYW5uZWxzLCB0aGlzLmluUmF0ZSwgdGhpcy5vdXRSYXRlLCB0aGlzLnF1YWxpdHksIGVyclB0cik7XG4gICAgICBjb25zdCBlcnJOdW0gPSBzcGVleE1vZHVsZS5nZXRWYWx1ZShlcnJQdHIsICdpMzInKTtcbiAgICAgIGlmIChlcnJOdW0gIT09IDApIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKHNwZWV4TW9kdWxlLkFzY2lpVG9TdHJpbmcoc3BlZXhNb2R1bGUuX3NwZWV4X3Jlc2FtcGxlcl9zdHJlcnJvcihlcnJOdW0pKSk7XG4gICAgICB9XG4gICAgICB0aGlzLl9pbkxlbmd0aFB0ciA9IHNwZWV4TW9kdWxlLl9tYWxsb2MoVWludDMyQXJyYXkuQllURVNfUEVSX0VMRU1FTlQpO1xuICAgICAgdGhpcy5fb3V0TGVuZ3RoUHRyID0gc3BlZXhNb2R1bGUuX21hbGxvYyhVaW50MzJBcnJheS5CWVRFU19QRVJfRUxFTUVOVCk7XG4gICAgfVxuXG4gICAgLy8gUmVzaXppbmcgdGhlIGlucHV0IGJ1ZmZlciBpbiB0aGUgV0FTTSBtZW1vcnkgc3BhY2UgdG8gbWF0Y2ggd2hhdCB3ZSBuZWVkXG4gICAgaWYgKHRoaXMuX2luQnVmZmVyU2l6ZSA8IGNodW5rLmxlbmd0aCkge1xuICAgICAgaWYgKHRoaXMuX2luQnVmZmVyUHRyICE9PSAtMSkge1xuICAgICAgICBzcGVleE1vZHVsZS5fZnJlZSh0aGlzLl9pbkJ1ZmZlclB0cik7XG4gICAgICB9XG4gICAgICB0aGlzLl9pbkJ1ZmZlclB0ciA9IHNwZWV4TW9kdWxlLl9tYWxsb2MoY2h1bmsubGVuZ3RoKTtcbiAgICAgIHRoaXMuX2luQnVmZmVyU2l6ZSA9IGNodW5rLmxlbmd0aDtcbiAgICB9XG5cbiAgICAvLyBSZXNpemluZyB0aGUgb3V0cHV0IGJ1ZmZlciBpbiB0aGUgV0FTTSBtZW1vcnkgc3BhY2UgdG8gbWF0Y2ggd2hhdCB3ZSBuZWVkXG4gICAgY29uc3Qgb3V0QnVmZmVyTGVuZ3RoVGFyZ2V0ID0gTWF0aC5jZWlsKGNodW5rLmxlbmd0aCAqIHRoaXMub3V0UmF0ZSAvIHRoaXMuaW5SYXRlKTtcbiAgICBpZiAodGhpcy5fb3V0QnVmZmVyU2l6ZSA8IG91dEJ1ZmZlckxlbmd0aFRhcmdldCkge1xuICAgICAgaWYgKHRoaXMuX291dEJ1ZmZlclB0ciAhPT0gLTEpIHtcbiAgICAgICAgc3BlZXhNb2R1bGUuX2ZyZWUodGhpcy5fb3V0QnVmZmVyUHRyKTtcbiAgICAgIH1cbiAgICAgIHRoaXMuX291dEJ1ZmZlclB0ciA9IHNwZWV4TW9kdWxlLl9tYWxsb2Mob3V0QnVmZmVyTGVuZ3RoVGFyZ2V0KTtcbiAgICAgIHRoaXMuX291dEJ1ZmZlclNpemUgPSBvdXRCdWZmZXJMZW5ndGhUYXJnZXQ7XG4gICAgfVxuXG4gICAgLy8gbnVtYmVyIG9mIHNhbXBsZXMgcGVyIGNoYW5uZWwgaW4gaW5wdXQgYnVmZmVyXG4gICAgc3BlZXhNb2R1bGUuc2V0VmFsdWUodGhpcy5faW5MZW5ndGhQdHIsIGNodW5rLmxlbmd0aCAvIHRoaXMuY2hhbm5lbHMgLyBGbG9hdDMyQXJyYXkuQllURVNfUEVSX0VMRU1FTlQsICdpMzInKTtcbiAgICAvLyBDb3B5aW5nIHRoZSBpbmZvIGZyb20gdGhlIGlucHV0IEJ1ZmZlciBpbiB0aGUgV0FTTSBtZW1vcnkgc3BhY2VcbiAgICBzcGVleE1vZHVsZS5IRUFQVTguc2V0KGNodW5rLCB0aGlzLl9pbkJ1ZmZlclB0cik7XG5cbiAgICAvLyBudW1iZXIgb2Ygc2FtcGxlcyBwZXIgY2hhbm5lbHMgYXZhaWxhYmxlIGluIG91dHB1dCBidWZmZXJcbiAgICBzcGVleE1vZHVsZS5zZXRWYWx1ZSh0aGlzLl9vdXRMZW5ndGhQdHIsIHRoaXMuX291dEJ1ZmZlclNpemUgLyB0aGlzLmNoYW5uZWxzIC8gRmxvYXQzMkFycmF5LkJZVEVTX1BFUl9FTEVNRU5ULCAnaTMyJyk7XG4gICAgY29uc3QgZXJyTnVtID0gc3BlZXhNb2R1bGUuX3NwZWV4X3Jlc2FtcGxlcl9wcm9jZXNzX2ludGVybGVhdmVkX2Zsb2F0KFxuICAgICAgdGhpcy5fcmVzYW1wbGVyUHRyLFxuICAgICAgdGhpcy5faW5CdWZmZXJQdHIsXG4gICAgICB0aGlzLl9pbkxlbmd0aFB0cixcbiAgICAgIHRoaXMuX291dEJ1ZmZlclB0cixcbiAgICAgIHRoaXMuX291dExlbmd0aFB0cixcbiAgICApO1xuXG4gICAgaWYgKGVyck51bSAhPT0gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKHNwZWV4TW9kdWxlLkFzY2lpVG9TdHJpbmcoc3BlZXhNb2R1bGUuX3NwZWV4X3Jlc2FtcGxlcl9zdHJlcnJvcihlcnJOdW0pKSk7XG4gICAgfVxuXG4gICAgY29uc3Qgb3V0U2FtcGxlc1BlckNoYW5uZWxzV3JpdHRlbiA9IHNwZWV4TW9kdWxlLmdldFZhbHVlKHRoaXMuX291dExlbmd0aFB0ciwgJ2kzMicpO1xuXG4gICAgLy8gd2UgYXJlIGNvcHlpbmcgdGhlIGluZm8gaW4gYSBuZXcgYnVmZmVyIGhlcmUsIHdlIGNvdWxkIGp1c3QgcGFzcyBhIGJ1ZmZlciBwb2ludGluZyB0byB0aGUgc2FtZSBtZW1vcnkgc3BhY2UgaWYgbmVlZGVkXG4gICAgcmV0dXJuIEJ1ZmZlci5mcm9tKFxuICAgICAgc3BlZXhNb2R1bGUuSEVBUFU4LnNsaWNlKFxuICAgICAgICB0aGlzLl9vdXRCdWZmZXJQdHIsXG4gICAgICAgIHRoaXMuX291dEJ1ZmZlclB0ciArIG91dFNhbXBsZXNQZXJDaGFubmVsc1dyaXR0ZW4gKiB0aGlzLmNoYW5uZWxzICogRmxvYXQzMkFycmF5LkJZVEVTX1BFUl9FTEVNRU5UXG4gICAgICApLmJ1ZmZlcik7XG4gIH1cbn1cblxuY29uc3QgRU1QVFlfQlVGRkVSID0gQnVmZmVyLmFsbG9jKDApO1xuXG5leHBvcnQgY2xhc3MgU3BlZXhSZXNhbXBsZXJUcmFuc2Zvcm0gZXh0ZW5kcyBUcmFuc2Zvcm0ge1xuICByZXNhbXBsZXI6IFNwZWV4UmVzYW1wbGVyO1xuICBfYWxpZ25lbWVudEJ1ZmZlcjogQnVmZmVyO1xuXG4gIC8qKlxuICAgICogQ3JlYXRlIGFuIFNwZWV4UmVzYW1wbGVyIGluc3RhbmNlLlxuICAgICogQHBhcmFtIGNoYW5uZWxzIE51bWJlciBvZiBjaGFubmVscywgbWluaW11bSBpcyAxLCBubyBtYXhpbXVtXG4gICAgKiBAcGFyYW0gaW5SYXRlIGZyZXF1ZW5jeSBpbiBIeiBmb3IgdGhlIGlucHV0IGNodW5rXG4gICAgKiBAcGFyYW0gb3V0UmF0ZSBmcmVxdWVuY3kgaW4gSHogZm9yIHRoZSB0YXJnZXQgY2h1bmtcbiAgICAqIEBwYXJhbSBxdWFsaXR5IG51bWJlciBmcm9tIDEgdG8gMTAsIGRlZmF1bHQgdG8gNywgMSBpcyBmYXN0IGJ1dCBvZiBiYWQgcXVhbGl0eSwgMTAgaXMgc2xvdyBidXQgYmVzdCBxdWFsaXR5XG4gICAgKi9cbiAgY29uc3RydWN0b3IocHVibGljIGNoYW5uZWxzLCBwdWJsaWMgaW5SYXRlLCBwdWJsaWMgb3V0UmF0ZSwgcHVibGljIHF1YWxpdHkgPSA3KSB7XG4gICAgc3VwZXIoKTtcbiAgICB0aGlzLnJlc2FtcGxlciA9IG5ldyBTcGVleFJlc2FtcGxlcihjaGFubmVscywgaW5SYXRlLCBvdXRSYXRlLCBxdWFsaXR5KTtcbiAgICB0aGlzLmNoYW5uZWxzID0gY2hhbm5lbHM7XG4gICAgdGhpcy5fYWxpZ25lbWVudEJ1ZmZlciA9IEVNUFRZX0JVRkZFUjtcbiAgfVxuXG4gIF90cmFuc2Zvcm0oY2h1bmssIGVuY29kaW5nLCBjYWxsYmFjaykge1xuICAgIGxldCBjaHVua1RvUHJvY2VzczogQnVmZmVyID0gY2h1bms7XG4gICAgaWYgKHRoaXMuX2FsaWduZW1lbnRCdWZmZXIubGVuZ3RoID4gMCkge1xuICAgICAgY2h1bmtUb1Byb2Nlc3MgPSBCdWZmZXIuY29uY2F0KFtcbiAgICAgICAgdGhpcy5fYWxpZ25lbWVudEJ1ZmZlcixcbiAgICAgICAgY2h1bmssXG4gICAgICBdKTtcbiAgICAgIHRoaXMuX2FsaWduZW1lbnRCdWZmZXIgPSBFTVBUWV9CVUZGRVI7XG4gICAgfVxuICAgIC8vIFNwZWV4IG5lZWRzIGEgYnVmZmVyIGFsaWduZWQgdG8gMTZiaXRzIHRpbWVzIHRoZSBudW1iZXIgb2YgY2hhbm5lbHNcbiAgICAvLyBzbyB3ZSBrZWVwIHRoZSBleHRyYW5lb3VzIGJ5dGVzIGluIGEgYnVmZmVyIGZvciBuZXh0IGNodW5rXG4gICAgY29uc3QgZXh0cmFuZW91c0J5dGVzQ291bnQgPSBjaHVua1RvUHJvY2Vzcy5sZW5ndGggJSAodGhpcy5jaGFubmVscyAqIFVpbnQxNkFycmF5LkJZVEVTX1BFUl9FTEVNRU5UKTtcbiAgICBpZiAoZXh0cmFuZW91c0J5dGVzQ291bnQgIT09IDApIHtcbiAgICAgIHRoaXMuX2FsaWduZW1lbnRCdWZmZXIgPSBCdWZmZXIuZnJvbShjaHVua1RvUHJvY2Vzcy5zbGljZShjaHVua1RvUHJvY2Vzcy5sZW5ndGggLSBleHRyYW5lb3VzQnl0ZXNDb3VudCkpO1xuICAgICAgY2h1bmtUb1Byb2Nlc3MgPSBjaHVua1RvUHJvY2Vzcy5zbGljZSgwLCBjaHVua1RvUHJvY2Vzcy5sZW5ndGggLSBleHRyYW5lb3VzQnl0ZXNDb3VudCk7XG4gICAgfVxuICAgIHRyeSB7XG4gICAgICBjb25zdCByZXMgPSB0aGlzLnJlc2FtcGxlci5wcm9jZXNzQ2h1bmsoY2h1bmtUb1Byb2Nlc3MpO1xuICAgICAgY2FsbGJhY2sobnVsbCwgcmVzKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBjYWxsYmFjayhlKTtcbiAgICB9XG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgU3BlZXhSZXNhbXBsZXI7XG4iXX0=