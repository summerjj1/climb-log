import {ShowcaseStore,SHOWCASE_PAGE_SIZE} from './showcase-store.js';
import {safePoster} from './video.js';
import {streamingURL} from './video-stream.js';
import {fragmentedPlayback} from './fragmented-player.js';
const html = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const errorText = e => /42P01|42501|PGRST/.test(String(e?.code)) ? '分享服务暂未就绪，请稍后重试。' : '操作未完成，请检查网络后重试。';
export function installShowcase({client,login,toast,editRoute}) {
  const $ = s => document.querySelector(s);
  const entry=document.createElement('div');
  entry.className='showcase-entry';
  entry.innerHTML='<button type="button" id="open-showcase" class="showcase-nav">大神展示 <span>看看攀友的精彩一攀 →</span></button>';
  $('.topbar').after(entry);
  const nicknameButton=document.createElement('button');
  nicknameButton.id='edit-nickname';nicknameButton.type='button';nicknameButton.className='text-button';nicknameButton.textContent='设置昵称';
  $('#cloud-actions').prepend(nicknameButton);
  document.body.insertAdjacentHTML('beforeend', `
    <dialog id="nickname-dialog" class="auth-dialog" aria-labelledby="nickname-title"><form id="nickname-form">
      <div class="dialog-heading"><h2 id="nickname-title">我的昵称</h2><button type="button" class="text-button" data-dismiss="nickname-dialog" aria-label="关闭昵称设置">关闭</button></div>
      <p>在大神展示中用昵称认识彼此。</p><label>昵称<input id="nickname-input" maxlength="48" autocomplete="nickname" required placeholder="给自己起个名字，1–24 个字"></label>
      <p id="nickname-error" class="form-error" role="status"></p><button type="submit" class="primary">保存昵称</button>
    </form></dialog>
    <dialog id="share-dialog" class="auth-dialog" aria-labelledby="share-title">
      <div class="dialog-heading"><h2 id="share-title">分享至大神展示</h2><button type="button" class="text-button" data-dismiss="share-dialog" aria-label="关闭分享窗口">关闭</button></div>
      <div id="share-preview"></div><p>分享后，登录的攀友可以观看这个视频，并看到你的昵称、线路名、岩馆和难度。私人备注不展示。</p>
      <p id="share-status" role="status"></p><div class="showcase-actions"><button id="share-publish" type="button" class="primary">确认分享</button><button id="share-revoke" type="button" class="text-button" hidden>取消分享</button><button id="share-copy" type="button" class="text-button" hidden>复制分享链接</button></div>
    </dialog>
    <dialog id="showcase-dialog" class="showcase-dialog" aria-labelledby="showcase-title">
      <div class="dialog-heading"><div><span class="showcase-kicker">PANLEMEI / COMMUNITY</span><h2 id="showcase-title">大神展示</h2><p>每一次突破，都值得被看见。</p></div><button type="button" class="text-button" data-dismiss="showcase-dialog" aria-label="关闭大神展示">返回我的线路</button></div>
      <div class="showcase-actions"><button id="showcase-refresh" type="button" class="text-button">刷新展示</button><button id="showcase-all" type="button" class="text-button" hidden>查看全部分享</button></div>
      <p id="showcase-status" role="status"></p><button id="showcase-login" type="button" class="primary" hidden>登录后查看</button><div id="showcase-grid" class="showcase-grid"></div><button id="showcase-more" type="button" class="text-button" hidden>加载更多</button>
    </dialog>
    <dialog id="showcase-player" class="showcase-player" aria-labelledby="showcase-player-title"><div class="dialog-heading"><h2 id="showcase-player-title">攀爬视频</h2><button type="button" class="text-button" data-dismiss="showcase-player" aria-label="关闭视频">关闭</button></div><video controls playsinline preload="none" crossorigin="anonymous"></video><p id="showcase-play-status" role="status"></p><button id="showcase-retry" type="button" class="text-button" hidden>重试播放</button></dialog>
  `);
  let store=null,user=null,nickname='',epoch=0,feedRequest=0,shareRequest=0,posts=[],offset=0,shareRoute=null,shareId=null,playController=null,playing=null;
  const initialId=new URL(location.href).searchParams.get('showcase');
  let focusedId=uuid.test(initialId||'') ? initialId : null;
  const stop=()=>{playController?.abort();playController=null;const v=$('#showcase-player video');v.pause();v.removeAttribute('src');v.removeAttribute('poster');v.load();};
  document.querySelectorAll('[data-dismiss]').forEach(b=>b.onclick=()=>$('#'+b.dataset.dismiss).close());
  $('#showcase-player').addEventListener('close',stop);
  $('#share-dialog').addEventListener('close',()=>{shareRequest++;});
  $('#showcase-dialog').addEventListener('close',()=>{feedRequest++;stop();});
  const updateNickname=()=>{nicknameButton.textContent=nickname ? `昵称：${nickname}` : '设置昵称';};
  function openNickname() {if(!store)return login();$('#nickname-input').value=nickname;$('#nickname-error').textContent='';$('#nickname-dialog').showModal();}
  nicknameButton.onclick=openNickname;
  $('#nickname-form').onsubmit=async event=>{
    event.preventDefault();const e=epoch,s=store,button=event.submitter;
    if(!s)return;
    button.disabled=true;$('#nickname-error').textContent='';
    try {const name=await s.saveNickname($('#nickname-input').value);if(e!==epoch)return;nickname=name;updateNickname();$('#nickname-dialog').close();toast('昵称已保存');}
    catch(error){if(e===epoch)$('#nickname-error').textContent=error.message?.startsWith('昵称请输入')?error.message:errorText(error);}
    finally{button.disabled=false;}
  };
  async function feed(append=false) {
    const request=++feedRequest,e=epoch,s=store;
    $('#showcase-login').hidden=!!s;$('#showcase-refresh').hidden=!s;$('#showcase-more').hidden=true;$('#showcase-all').hidden=!focusedId;
    if(!append){posts=[];offset=0;$('#showcase-grid').replaceChildren();}
    if(!s){$('#showcase-status').textContent='登录后，可以观看攀友主动分享的视频。';return;}
    $('#showcase-status').textContent='正在加载封面…';$('#showcase-refresh').disabled=true;
    try {
      const rows=await s.list(offset,focusedId);
      if(e!==epoch||request!==feedRequest)return;
      posts=append?[...posts,...rows.filter(r=>!posts.some(p=>p.id===r.id))]:rows;offset+=rows.length;
      renderFeed();$('#showcase-status').textContent=posts.length ? `${posts.length} 个精彩瞬间 · 点击封面播放` : focusedId ? '分享已取消或暂时不可用。' : '还没有分享。打开自己的视频详情，成为第一个分享的攀友。';
      $('#showcase-more').hidden=!!focusedId||rows.length<SHOWCASE_PAGE_SIZE;
    } catch(error){if(e===epoch&&request===feedRequest)$('#showcase-status').textContent=errorText(error);}
    finally{if(e===epoch&&request===feedRequest)$('#showcase-refresh').disabled=false;}
  }
  function renderFeed() {
    $('#showcase-grid').innerHTML=posts.map(p=>`<article class="showcase-card"><button type="button" class="showcase-cover" data-watch="${html(p.id)}" aria-label="播放：${html(p.title)}">${safePoster(p.poster)?`<img src="${p.poster}" alt="${html(p.title)}封面" loading="lazy">`:'<span>攀爬视频</span>'}<span class="showcase-play" aria-hidden="true">▶</span></button><div class="showcase-card-body"><p class="showcase-author">${html(p.nickname)}</p><h3>${html(p.title)}</h3><p>${html(p.gym_name)} <span>· ${html(p.grade)}</span></p><div class="showcase-actions"><button type="button" class="text-button" data-link="${html(p.id)}">复制链接</button>${p.owner_id===String(user?.id)?`<button type="button" class="text-button" data-edit-share="${html(p.route_id)}">修改线路信息</button><button type="button" class="text-button" data-unshare="${html(p.id)}">取消分享</button>`:''}</div></div></article>`).join('');
    $('#showcase-grid').querySelectorAll('[data-watch]').forEach(b=>b.onclick=()=>play(posts.find(p=>p.id===b.dataset.watch)));
    $('#showcase-grid').querySelectorAll('[data-edit-share]').forEach(b=>b.onclick=()=>{$('#showcase-dialog').close();editRoute(b.dataset.editShare);});
    $('#showcase-grid').querySelectorAll('[data-link]').forEach(b=>b.onclick=()=>copyLink(b.dataset.link));
    $('#showcase-grid').querySelectorAll('[data-unshare]').forEach(b=>b.onclick=async()=>{const e=epoch,s=store;b.disabled=true;try{await s.revoke(b.dataset.unshare);if(e!==epoch)return;toast('已取消分享');await feed();}catch(error){if(e===epoch){toast(errorText(error));b.disabled=false;}}});
  }
  async function copyLink(id) {
    const url=new URL(import.meta.env.BASE_URL,location.origin);url.searchParams.set('showcase',id);
    try{await navigator.clipboard.writeText(url.href);toast('链接已复制，对方登录后即可观看');}
    catch{const text=document.createElement('input');text.value=url.href;text.readOnly=true;text.setAttribute('aria-label','分享链接');$('#share-status').replaceChildren(text);if(!$('#share-dialog').open){$('#showcase-status').replaceChildren(text);}text.select();toast('请复制显示的分享链接');}
  }
  async function play(post) {
    if(!store||!post)return;
    stop();playing=post;const s=store,e=epoch,controller=new AbortController();playController=controller;
    const video=$('#showcase-player video');$('#showcase-player-title').textContent=post.title;$('#showcase-play-status').textContent='正在准备播放…';$('#showcase-retry').hidden=true;
    if(safePoster(post.poster))video.poster=post.poster;
    if(!$('#showcase-player').open)$('#showcase-player').showModal();
    const fail=()=>{if(controller.signal.aborted||e!==epoch)return;stop();$('#showcase-play-status').textContent='暂时无法播放，分享可能已取消，或网络连接失败。';$('#showcase-retry').hidden=false;};
    try {
      const {source,route}=await s.source(post,{signal:controller.signal});
      const fragmented=await fragmentedPlayback(source,route,{signal:controller.signal,onError:fail});
      const url=fragmented?.url||await streamingURL(source,{signal:controller.signal,onError:fail});
      controller.signal.throwIfAborted();if(e!==epoch)return;
      video.src=url;fragmented?.attach(video);video.onerror=fail;
      $('#showcase-play-status').textContent='边加载边播放';
      try{await video.play();}catch(error){if(error.name==='NotAllowedError')$('#showcase-play-status').textContent='视频已就绪，请点击播放。';else fail();}
    }catch{fail();}
  }
  $('#showcase-retry').onclick=()=>play(playing);
  $('#open-showcase').onclick=()=>{focusedId=null;$('#showcase-dialog').showModal();void feed();};
  $('#showcase-refresh').onclick=()=>feed();$('#showcase-more').onclick=()=>feed(true);
  $('#showcase-all').onclick=()=>{focusedId=null;void feed();};
  $('#showcase-login').onclick=()=>{$('#showcase-dialog').close();login();};
  async function share(route,gym) {
    if(!store)return login();
    if(!route.photoPath)return toast('请先将视频保存到云端，再分享。');
    const s=store,e=epoch,request=++shareRequest;shareRoute=route;shareId=null;
    $('#share-preview').innerHTML=`${safePoster(route.poster)?`<img class="share-poster" src="${route.poster}" alt="视频封面">`:''}<h3>${html(route.name)}</h3><p>${html(gym)} · ${html(route.grade)}</p>`;
    $('#share-status').textContent='正在检查分享状态…';$('#share-publish').hidden=false;$('#share-publish').disabled=true;$('#share-revoke').hidden=true;$('#share-copy').hidden=true;
    $('#share-dialog').showModal();
    try{const shared=await s.ownShare(route.id);if(e!==epoch||request!==shareRequest)return;shareId=shared?.id||null;shareControls();}
    catch(error){if(e===epoch&&request===shareRequest)$('#share-status').textContent=errorText(error);}
  }
  function shareControls() {
    $('#share-publish').disabled=false;$('#share-publish').hidden=!!shareId;$('#share-revoke').hidden=!shareId;$('#share-copy').hidden=!shareId;
    $('#share-status').textContent=shareId?'已分享。取消分享后，其他人将无法新开播放；已缓冲内容及短时播放地址可能暂时可用。':nickname?`以「${nickname}」分享。`:'分享前，请先设置昵称。';
    $('#share-publish').textContent=nickname?'确认分享':'先设置昵称';
  }
  $('#share-publish').onclick=async()=>{
    if(!nickname){openNickname();return;}
    const e=epoch,s=store,request=shareRequest;$('#share-publish').disabled=true;
    try{const post=await s.publish(shareRoute.id);if(e!==epoch||request!==shareRequest)return;shareId=post.id;shareControls();toast('已分享至大神展示');}
    catch(error){if(e===epoch&&request===shareRequest){$('#share-status').textContent=errorText(error);$('#share-publish').disabled=false;}}
  };
  $('#nickname-dialog').addEventListener('close',()=>{if($('#share-dialog').open&&store)shareControls();});
  $('#share-revoke').onclick=async()=>{const s=store,e=epoch,request=shareRequest;$('#share-revoke').disabled=true;try{await s.revoke(shareId);if(e!==epoch||request!==shareRequest)return;shareId=null;shareControls();toast('已取消分享');}catch(error){if(e===epoch)$('#share-status').textContent=errorText(error);}finally{$('#share-revoke').disabled=false;}};
  $('#share-copy').onclick=()=>copyLink(shareId);
  return {
    share,
    async setUser(next) {
      const e=++epoch;feedRequest++;shareRequest++;stop();
      for(const id of ['showcase-player','share-dialog','nickname-dialog','showcase-dialog'])$('#'+id).close();
      user=next;store=next?new ShowcaseStore(client,next.id):null;nickname='';posts=[];shareId=null;shareRoute=null;playing=null;
      $('#showcase-grid').replaceChildren();$('#share-preview').replaceChildren();$('#nickname-input').value='';updateNickname();
      if(store){try{const name=await store.profile();if(e!==epoch)return;nickname=name;updateNickname();}catch{/* Profile retries are available through settings; private routes still load. */}}
      if(e===epoch&&focusedId){$('#showcase-dialog').showModal();void feed();}
    },
    start(){if(focusedId){$('#showcase-dialog').showModal();void feed();}}
  };
}
