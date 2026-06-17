import * as buffer from 'buffer';

const bufferModule = buffer as typeof buffer & {
  SlowBuffer?: typeof Buffer;
};

if (!bufferModule.SlowBuffer) {
  Object.defineProperty(bufferModule, 'SlowBuffer', {
    value: Buffer,
    configurable: true,
  });
}
