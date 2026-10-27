import {CloudStore} from './cloud-store.js';
import {mediaPaths} from './chunked-media.js';
export const SHOWCASE_PAGE_SIZE = 12;
export function nicknameValue(value) {
  const name = String(value || '').trim();
  if (!name || Array.from(name).length > 24 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error('昵称请输入 1–24 个字，不包含换行。');
  return name;
}
const unwrap = ({data,error}) => {if(error)throw error;return data;};
export class ShowcaseStore {
  constructor(client,userId) { this.client=client; this.userId=String(userId); }
  async profile() { return unwrap(await this.client.from('climb_profiles').select('nickname').eq('user_id',this.userId).maybeSingle())?.nickname || ''; }
  async saveNickname(value) {
    const nickname=nicknameValue(value);
    unwrap(await this.client.from('climb_profiles').upsert({user_id:this.userId,nickname},{onConflict:'user_id'}));
    return nickname;
  }
  async ownShare(routeId) { return unwrap(await this.client.from('climb_showcase').select('id').eq('owner_id',this.userId).eq('route_id',routeId).maybeSingle()); }
  async publish(routeId) {
    return unwrap(await this.client.from('climb_showcase').insert({owner_id:this.userId,route_id:routeId}).select('id').single());
  }
  async revoke(id) { unwrap(await this.client.from('climb_showcase').delete().eq('id',id).eq('owner_id',this.userId)); }
  async list(offset=0,id=null) {
    let query=this.client.from('climb_showcase').select('id,owner_id,route_id,title,gym_name,grade,poster,video,created_at');
    query=id ? query.eq('id',id) : query.order('created_at',{ascending:false}).order('id',{ascending:false}).range(offset,offset+SHOWCASE_PAGE_SIZE-1);
    const rows=unwrap(await query)||[];
    if(!rows.length)return [];
    const profiles=unwrap(await this.client.from('climb_profiles').select('user_id,nickname').in('user_id',[...new Set(rows.map(r=>r.owner_id))]))||[];
    const names=new Map(profiles.map(p=>[p.user_id,p.nickname]));
    return rows.map(r=>({...r,nickname:names.get(r.owner_id)||'攀友'}));
  }
  async source(post,options) {
    // Fetch again at play time: deleted shares cannot start from stale feed data.
    const rows=await this.list(0,post.id), current=rows[0];
    options.signal.throwIfAborted();
    if(!current)throw new Error('分享已取消或暂时不可用。');
    mediaPaths(current.video,current.owner_id);
    const reader=new CloudStore(this.client,current.owner_id,null,{signedUrlSeconds:120});
    return {source:await reader.videoSource(current.video,options),route:current.video};
  }
}
