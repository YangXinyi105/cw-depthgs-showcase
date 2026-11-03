// Converts a user's model off the main thread. Keeps the parsed Gaussians so a flip
// (when the automatic up direction is wrong) does not re-read the file.
import {readGaussians, convert} from './cloud-convert.js?v=20261103-upload';

let gaussians = null;
self.onmessage = async ({data}) => {
  try {
    if (data.file) {
      gaussians = null;
      gaussians = await readGaussians(data.file, data.file.name, f => self.postMessage({progress: f}));
    }
    if (!gaussians) throw Error('请先选择模型文件');
    const cloud = convert(gaussians, data.options);
    self.postMessage({cloud}, [cloud.position.buffer, cloud.rgba.buffer, cloud.size.buffer]);
  } catch (error) {
    self.postMessage({error: error.message || String(error)});
  }
};
