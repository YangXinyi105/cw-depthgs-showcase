// Converts a model off the main thread. Keeps the parsed Gaussians so a flip (when the automatic
// up direction is wrong) does not re-read the file. Replies carry the request's id, if any.
import {readGaussians, convert} from './cloud-convert.js?v=20261104-e2e';

let gaussians = null;
self.onmessage = async ({data}) => {
  const id = data.id;
  try {
    if (data.file) {
      gaussians = null;
      gaussians = await readGaussians(data.file, data.name || data.file.name, f => self.postMessage({id, progress: f}));
    }
    if (!gaussians) throw Error('请先选择模型文件');
    const cloud = convert(gaussians, data.options);
    self.postMessage({id, cloud}, [cloud.position.buffer, cloud.rgba.buffer, cloud.size.buffer]);
  } catch (error) {
    self.postMessage({id, error: error.message || String(error)});
  }
};
