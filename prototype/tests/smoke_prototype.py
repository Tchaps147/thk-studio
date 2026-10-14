"""Headless smoke test of the built prototype (prototype/dist/studio.html).

    python prototype/build_studio.py && python prototype/tests/smoke_prototype.py

Stubs window.claude so the assistant's tool calls run against scripted responses (no real Claude call),
then checks playback, export (WAV/MIDI/zip), assistant tools and rollback, variations (try / keep / back),
groove presets and migration of v2 sound ids. These are the behaviours the TypeScript port must keep;
port each block into a Playwright/Vitest test.
"""
import asyncio, json, os, sys
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(HERE, "..", "dist")
STUB = r"""
window.__calls = [];
const fake = async (input, opts) => {
  const last = input[input.length - 1].content; window.__lastInput = input;
  const T = n => opts.tools.find(t => t.name === n);
  const run = async (n, a) => { try { const r = await T(n).execute(a, { signal: new AbortController().signal }); window.__calls.push([n, 'ok', r]); } catch (e) { window.__calls.push([n, 'err', e.message]); } };
  if (last.includes('TEST1')) {
    await run('write_drums', { track: 'Groove', start_bar: 1, bars: 16, pattern_bars: 1, lanes: [{ sound: 'kick', steps: 'x---x---x---x---' }] });
    await run('write_drums', { track: 'Groove', start_bar: 1, bars: 16, pattern_bars: 1, lanes: [{ sound: 'closed hat', steps: 'oo-xoo-xoo-xoo-x' }, { sound: 'THK_HatO_04_Dark', steps: '--x---x---x---x-' }] });
    await run('write_drums', { track: 'Groove', start_bar: 1, bars: 4, pattern_bars: 1, lanes: [{ sound: 'banana', steps: 'x---' }] });
    await run('write_notes', { track: 'Bass', start_bar: 9, bars: 8, pattern_bars: 1, notes: [{ step: 2, note: 'F2', len: 2 }, { step: 6, note: 'G#2', len: 1 }], sound: 'THK_Bass_25_Fat_Ladder_C' });
    await run('set_song', { key: 'G', bpm: 126 });
    opts.onText({ text: 'Wrote a kick and hats on Groove.', delta: 'x' });
    return { text: 'Wrote a kick and hats on Groove.', truncated: false, modelTierApplied: 'quick' };
  }
  if (last.includes('TEST2')) {
    await run('offer_variations', { title: 'Drums for the bass', variations: [
      { name: 'Sparse', kind: 'drums', track: 'Tops', start_bar: 9, bars: 16, pattern_bars: 1, lanes: [{ sound: 'open hat', steps: '--x---x---x---x-' }] },
      { name: 'Busy', kind: 'drums', track: 'Tops', start_bar: 9, bars: 16, pattern_bars: 2, lanes: [{ sound: 'ride', steps: 'o-xo' }, { sound: 'clap', steps: '----x-------x---' }] },
      { name: 'Bass alt', kind: 'notes', track: 'Bass', start_bar: 9, bars: 16, pattern_bars: 1, notes: [{ step: 3, note: 'F1', len: 1 }] } ] });
    opts.onText({ text: 'Here are three.', delta: 'x' });
    return { text: 'Here are three.', truncated: false, modelTierApplied: 'quick' };
  }
  throw { code: 'rate_limited', message: 'x' };
};
fake.limits = async () => ({ maxPromptBytes: 262144, tools: { maxCount: 16 } });
window.claude = { use: async n => n === 'sample' ? fake : null };
"""
OLD = {"v":1,"name":"Old","bpm":124,"swing":54,"loop":{"on":False,"start":0,"end":4},"tracks":[{"id":"a1","name":"Drums","type":"drums","color":0,"vol":0.8,"pan":0,"cutoff":20000,"send":0,"mute":False,"solo":False,"clips":[],"pads":["THK_Kick_02_Classic_909_G","THK_Perc_01_Clap_Classic","THK_Perc_04_Hat_Closed_Tight","THK_Perc_06_Hat_Open","THK_Perc_08_Shaker","THK_Perc_09_Rim_Shot","THK_Perc_10_Snare_Tech","THK_Perc_11_Conga_Hi"]}]}


def wrap():
    html = open(os.path.join(DIST, "studio.html")).read()
    path = os.path.join(DIST, "page.html")   # the artifact host adds this skeleton at publish time
    open(path, "w").write('<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1">'
                          '<style>[hidden]{display:none!important}</style></head><body>' + html + '</body></html>')
    return "file://" + os.path.abspath(path)


async def main():
    url = wrap(); errs = []
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
        ctx = await b.new_context(viewport={"width": 1500, "height": 1000}); await ctx.add_init_script(STUB)
        pg = await ctx.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)))
        ev = pg.evaluate
        await pg.goto(url); await pg.wait_for_timeout(1500)
        assert await ev("Object.keys(buffers).length") == await ev("KIT.length"), "not all sounds decoded"

        # migration of v2 ids
        await ev("localStorage.setItem('thk-studio-song-v1', JSON.stringify(%s))" % json.dumps(OLD))
        await pg.reload(); await pg.wait_for_timeout(1200)
        assert await ev("song.tracks[0].pads[1]") == "THK_Clap_01_Classic"
        await ev("localStorage.clear()"); await pg.reload(); await pg.wait_for_timeout(1200)

        # playback advances
        await pg.click("#playBtn"); await pg.wait_for_timeout(1200)
        assert await ev("T.pos") > 4, "playhead did not move"
        await pg.click("#playBtn")

        # export pipeline (without the download prompt)
        r = await ev("""async () => { const buf = await renderOffline(); const w = encodeWav(buf), m = encodeMidi();
            const z = makeZip([{name:'a.wav',data:w},{name:'a.mid',data:m}]); let pk = 0; const d = buf.getChannelData(0);
            for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i])); return {secs: buf.duration, pk, mid: Array.from(m.slice(0,4)), zip: z.size}; }""")
        assert r["secs"] > 60 and 0.1 < r["pk"] <= 1.0 and r["mid"] == [77, 84, 104, 100] and r["zip"] > 1e6, r

        # assistant: tools write, errors roll back, one undo per turn
        await pg.fill("#prompt", "TEST1"); await pg.keyboard.press("Enter"); await pg.wait_for_timeout(700)
        calls = await ev("window.__calls")
        assert [c[1] for c in calls] == ["ok", "ok", "err", "ok", "ok"], calls
        assert await ev("findTrack('Groove').clips[0].notes.length") == 20
        assert await ev("findTrack('Bass').sample") == "THK_Bass_25_Fat_Ladder_C"
        assert await ev("window.__lastInput[0].content.includes('Sound catalog')")
        await pg.click("text=Undo these changes"); await pg.wait_for_timeout(200)
        assert await ev("findTrack('Groove')") is None and await ev("song.bpm") == 125

        # variations: try swaps, back restores exactly, keep adds one undo step
        await pg.fill("#prompt", "TEST2"); await pg.keyboard.press("Enter"); await pg.wait_for_timeout(700)
        before = await ev("JSON.stringify(song.tracks)")
        card = lambda i: pg.locator(".var").nth(i).locator("button").first
        await card(1).click(); await pg.wait_for_timeout(300)
        assert await ev("T.playing") and await ev("song.loop.on")
        await card(2).click(); await pg.wait_for_timeout(200)
        await pg.click("text=Back to original"); await pg.wait_for_timeout(200)
        assert before == await ev("JSON.stringify(song.tracks)"), "Back to original did not restore"
        await card(0).click(); u0 = await ev("undoStack.length")
        await pg.click(".var button:has-text('Keep')")
        assert await ev("undoStack.length") == u0 + 1
        await pg.click("#playBtn")

        # groove preset follows the key
        await ev("sel.tid = findTrack('Bass').id; sel.cid = findTrack('Bass').clips[0].id; renderAll()")
        await pg.select_option("select[aria-label='Apply a groove preset']", label="Acid walk"); await pg.wait_for_timeout(200)
        assert await ev("pname(trackById(sel.tid).clips.find(c=>c.id===sel.cid).notes[0].p)") == "F2"

        await b.close()
    assert not errs, errs
    print("prototype smoke test passed")


asyncio.run(main())
