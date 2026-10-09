// Reads PUBLIC YouTube playlists, channels and single videos. Your API key stays here on the server.
const K = process.env.YOUTUBE_API_KEY;
const B = 'https://www.googleapis.com/youtube/v3/';

async function g(path, q) {
  const r = await fetch(B + path + '?' + new URLSearchParams({ ...q, key: K }));
  const j = await r.json();
  if (!r.ok) throw new Error((j.error && j.error.message) || 'YouTube error');
  return j;
}

// "Artist - Song" -> {artist, title}; otherwise use the channel name
function split(t, ch) {
  const m = t.split(/\s[-–—]\s/);
  return m.length > 1
    ? { artist: m[0].trim(), title: m.slice(1).join(' - ').trim() }
    : { artist: (ch || '').replace(/ - Topic$/, ''), title: t };
}
const secs = d => {
  const m = (d || '').match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/) || [];
  return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
};
const pick = th => (th && (th.high || th.medium || th.default || {}).url) || null;

async function durations(ids) {
  const out = {};
  if (!ids.length) return out;
  const vd = await g('videos', { part: 'contentDetails', id: ids.join(',') });
  vd.items.forEach(v => { out[v.id] = secs(v.contentDetails.duration); });
  return out;
}

async function toCD(p) {
  const it = await g('playlistItems', { part: 'snippet', playlistId: p.id, maxResults: 50 });
  const tracks = it.items
    .filter(i => i.snippet.resourceId && i.snippet.resourceId.videoId &&
      !['Private video', 'Deleted video'].includes(i.snippet.title))
    .map(i => ({ id: i.snippet.resourceId.videoId, ...split(i.snippet.title, i.snippet.videoOwnerChannelTitle) }));
  if (!tracks.length) return { id: p.id, count: 0 };
  const d = await durations(tracks.map(t => t.id));
  tracks.forEach(t => { t.dur = d[t.id] || 0; });
  return {
    id: p.id, name: p.snippet.title, cover: null, thumb: pick(p.snippet.thumbnails),
    count: tracks.length, dur: tracks.reduce((a, t) => a + t.dur, 0), tracks
  };
}

// Loose video links (for example from a video's Share button) become one CD
async function videosCD(ids) {
  const vd = await g('videos', { part: 'snippet,contentDetails', id: ids.join(',') });
  const by = {};
  vd.items.forEach(v => { by[v.id] = v; });
  const vids = ids.map(i => by[i]).filter(Boolean);
  const tracks = vids.map(v => ({ id: v.id, ...split(v.snippet.title, v.snippet.channelTitle), dur: secs(v.contentDetails.duration) }));
  return {
    id: 'v_' + ids.join('').slice(0, 40), name: tracks.length === 1 ? tracks[0].title : 'Song picks',
    cover: null, thumb: vids[0] ? pick(vids[0].snippet.thumbnails) : null,
    count: tracks.length, dur: tracks.reduce((a, t) => a + t.dur, 0), tracks
  };
}

module.exports = async (req, res) => {
  try {
    if (!K) return res.status(500).json({ error: 'Missing YOUTUBE_API_KEY in Vercel settings' });
    const lists = [], chans = [], vids = [];
    let note = '';
    for (const t of (req.query.q || '').split(/\s+/).filter(Boolean)) {
      const v = t.match(/youtu\.be\/([\w-]{11})/) || t.match(/[?&]v=([\w-]{11})/) || t.match(/\/(?:shorts|embed)\/([\w-]{11})/);
      const l = t.match(/[?&]list=([\w-]+)/) || t.match(/^(PL[\w-]{10,})$/);
      if (l) {
        if (/^(RD|WL|LL)/.test(l[1])) {          // YouTube Mixes and private lists cannot be read
          note = 'That link is a YouTube Mix or a private list, which can not be read. Use a normal public playlist.';
          if (v) vids.push(v[1]);                 // but keep the song it points to
        } else lists.push(l[1]);
        continue;
      }
      const h = t.match(/@[\w.\-]+/), c = t.match(/(UC[\w-]{22})/);
      if (h || c) { chans.push(c ? { id: c[1] } : { forHandle: h[0] }); continue; }
      if (v) vids.push(v[1]);
    }
    let pls = [];
    if (lists.length) pls = pls.concat((await g('playlists', { part: 'snippet', id: [...new Set(lists)].join(',') })).items || []);
    for (const ch of chans) {
      const cj = await g('channels', { part: 'id', ...ch });
      const cid = cj.items && cj.items[0] && cj.items[0].id;
      if (cid) pls = pls.concat((await g('playlists', { part: 'snippet', channelId: cid, maxResults: 12 })).items || []);
    }
    const cds = await Promise.all(pls.slice(0, 20).map(toCD));
    if (vids.length) cds.push(await videosCD([...new Set(vids)].slice(0, 50)));
    const out = cds.filter(c => c && c.count);
    if (!out.length) return res.status(404).json({ error: note || 'Nothing found. Make sure the playlist is public (or unlisted) and paste its link.' });
    res.setHeader('Cache-Control', 's-maxage=600');
    res.json({ cds: out });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
