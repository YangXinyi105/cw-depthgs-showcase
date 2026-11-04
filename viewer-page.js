// 三维浏览: the example models, a local .splat, and the models of the project opened in 项目档案.
// A view of an open model can be saved to that project as a photo for annotation.
import {initStandaloneViewer} from './viewer.js?v=20261104-download-progress';
import {markExample, restoreControl} from './examples.js?v=20261103-workflow';
import {currentProject, projectDetail, assetBlob, uploadAsset, canEditProject} from './project-link.js?v=20261104-download-progress';

const $ = id => document.getElementById(id);
const project = currentProject();
const snap = $('model-snap');
let openModel = null; // {name, fromProject}
const viewer = initStandaloneViewer({onChange: loaded => {
  if (!loaded) openModel = null;
  snap.disabled = !loaded || !canEditProject(project);
}});

['model-demo', 'model-light'].forEach(id => markExample($(id)));
$('model-file').before(restoreControl());

const cube = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/></svg>';
async function listProjectModels() {
  if (!project) return;
  const box = $('project-models');
  try {
    const detail = await projectDetail(project);
    const models = detail.assets.filter(a => a.kind === 'model');
    $('project-name').textContent = detail.project.name;
    $('project-hint').hidden = false;
    box.replaceChildren(...models.map(asset => {
      const card = Object.assign(document.createElement('button'), {type: 'button', className: 'thumb project-model'});
      card.innerHTML = `<span class="thumb-ico">${cube}</span><b></b><i></i>`;
      card.querySelector('b').textContent = asset.name.replace(/\.splat$/i, '');
      card.querySelector('i').textContent = '项目 · ' + (asset.size / 1024 / 1024).toFixed(1) + ' MB';
      card.title = asset.name;
      card.onclick = () => openProjectModel(asset, card);
      return card;
    }));
    if (!models.length) $('project-hint').textContent = '当前项目「' + detail.project.name + '」还没有模型，可在项目档案中上传 .splat。';
  } catch (error) {
    $('project-hint').hidden = false;
    $('project-hint').textContent = error.message;
  }
}
async function openProjectModel(asset, card) {
  document.querySelectorAll('.project-model').forEach(c => { c.disabled = true; });
  viewer.status.textContent = '正在连接项目服务，准备下载模型…';
  try {
    const mb = bytes => (bytes / 1024 / 1024).toFixed(1) + ' MB';
    const blob = await assetBlob(project, asset, undefined, ({loaded, total, percent}) => {
      viewer.status.textContent = percent === 100
        ? '模型下载完成 100%，正在准备渲染…'
        : '正在下载模型 ' + (percent === null ? '' : percent + '% · ') + mb(loaded) + (total ? ' / ' + mb(total) : '') + ' · ' + asset.name;
    });
    await viewer.load(new File([blob], asset.name), asset.name);
    openModel = {name: asset.name, fromProject: true};
    snap.disabled = !canEditProject(project);
  } catch (error) {
    viewer.status.textContent = '项目模型打开失败：' + error.message;
  } finally {
    document.querySelectorAll('.project-model').forEach(c => { c.disabled = false; });
    card.focus();
  }
}
// Any open model (example, local or project) can be captured into the current project.
snap.onclick = async () => {
  if (!canEditProject(project)) return;
  snap.disabled = true;
  try {
    const blob = await viewer.snapshot(), stamp = new Date().toTimeString().slice(0, 8).replace(/:/g, '');
    const base = (openModel?.name || document.querySelector('.splat-surface canvas')?.getAttribute('aria-label')?.split('，')[0] || '模型').replace(/\.(k?splat)$/i, '');
    await uploadAsset(project, blob, base + '-视角截图-' + stamp + '.png', 'photo');
    viewer.status.textContent = '已把当前视角存入项目「' + project.name + '」，可在项目档案或人工复核中标注。';
  } catch (error) {
    viewer.status.textContent = '截图保存失败：' + error.message;
  } finally {
    snap.disabled = false;
  }
};
listProjectModels();
