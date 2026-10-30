# BeatLab: the brief

## The improved prompt

> Build BeatLab into a complete, publishable beat-making workstation that a long-time FL Studio user can
> sit down at and work in without relearning anything.
>
> 1. **Works like FL Studio.** Numbered patterns edited in a channel rack and piano roll, then painted onto a
>    free-form playlist as clips, next to audio clips. Floating, resizable windows for the playlist, channel
>    rack, piano roll, mixer, browser and every plugin. FL's menu bar, toolbar, tools (draw, paint, delete,
>    mute, slice, select) and keyboard shortcuts, with a cheat sheet in the app. Two layouts: the current
>    hardware "Rig" and a classic multi-window "DAW" mode.
> 2. **Everything you touch makes sound.** Piano-roll keys, an on-screen keyboard, pads, MIDI controllers and
>    the computer keyboard all play the selected instrument, and can record.
> 3. **A built-in plugin library.** Original instruments and effects that cover the jobs FL's stock and
>    premium plugins do (subtractive, FM and wavetable synths, samplers, drum machines, slicers, EQ,
>    dynamics, delays, reverbs, modulation, distortion, vocal tools), each with its own window, presets and
>    automation. Original designs and names, not copies.
> 4. **Its own brain, free.** An assistant that runs on this computer with no account or API bill. It
>    understands requests like "make the hook darker and add a 808 slide every 4 bars", plans the steps,
>    shows them, and carries them out in the DAW, with every change undoable.
> 5. **A product, not a prototype.** A landing page with features, the plugin line-up, the brain, a
>    download and install guide, FAQ, changelog, privacy and credits; an installer; a sample library
>    BeatLab is allowed to ship; and licences checked for everything bundled.
> 6. **Proven to work.** Every feature covered by automated end-to-end tests through real mouse and keyboard
>    input, and checked by eye in both themes at laptop and desktop sizes.

## Boundaries

- **No copied plugins.** FL Studio's plugins, including the paid ones, are Image-Line's software. Copying
  them, their names or their look, or giving away "free versions", isn't something BeatLab can do. It gets
  original plugins that do the same jobs, and keeps exporting MIDI and WAV straight into FL Studio, where
  your own FL plugins live.
- **FL's workflow is fair game, its branding is not.** Patterns, channel rack, playlist, piano roll, mixer
  and the shortcut keys are how DAWs work, so BeatLab follows them. FL's logo, artwork and product names
  stay out of BeatLab's own branding.
- **Before publishing:** BeatLab currently plays FL Studio's sample packs from your own FL install. That's
  fine on your computer but they can't ship with BeatLab, so a published version needs its own samples.
  The landing page closely follows a design video you found. Its content is BeatLab's own, but give the
  layout and art your own spin before you publish it as a product.
- **The free brain** needs a one-time model download (about 1 GB) and a browser with WebGPU (Chrome or Edge
  on Windows). Its typed commands keep working instantly without that.

## Phases

1. **FL workspace (first pass done, 2026-10-28):** numbered patterns (new, clone, rename, colour, length)
   and a free playlist with pattern and audio clips on tracks; draw, paint, delete, mute, slice and select
   tools with snap, Alt for free placement, Shift-drag copies, right-click delete, Ctrl+B, zoom; markers;
   Rig and DAW layouts, the DAW one with floating, resizable windows over the playlist and a browser
   (plugins, sounds, project); FL's menu bar and shortcuts with a cheat sheet; playable piano-roll keys and
   a keyboard in every channel window. Still to come in this phase: automation clips (lanes exist),
   playlist track colours and grouping, channel routing to mixer inserts, the step-sequencer graph editor.
   **Done 2026-10-28:** all FL end-to-end tests pass. The playlist keeps its scroll after edits, automation
   lanes keep every point, Alt+T and Alt+N stand in for the Ctrl keys Chrome keeps, the top bar fits at
   1536 px, and DAW-mode mixer and master windows show live meters.
   **Landing (first pass of phase 4, 2026-10-28):** the intro stage plays as before, but the open player's
   layers are named after the studio's parts and morph into its five windows. Then come written sections
   with real recordings and stills (beatlab/media): the studio step by step, Rig vs DAW, the 12 styles,
   the plugins, numbers, shortcuts, getting started, FAQ, and an orange "Open studio" door with the
   changelog, privacy and credits. Still to do for publishing: a real Windows download, and the layout spin
   noted under Boundaries.
   **Smoother (2026-10-28):** step clicks, the scroll-wheel velocity and bar paging update the rack in
   place instead of rebuilding it; steps paint by dragging; audio opens on the first click; the turntable
   draws at 30 fps and not at all when off screen; the meters cost a third of what they did; and F10 has a
   buffer size choice for PCs that crackle. Measured in headless Chrome: no long stalls, no late notes.
   **Rest of the phase (2026-10-28):** automation clips on the playlist (volume, pan and filter cutoff,
   drawn and dragged), mixer buses that channels route into from every strip, and the channel
   rack's step graph for velocity and chance per step.
2. **Plugin library:** a plugin browser with categories, presets and favourites; new original instruments
   (three-oscillator synth, FM synth, wavetable synth, multi-zone sampler, drum synth, slicer) and effects
   (graphical parametric EQ, multiband compressor, gate and rhythmic volume shaper, transient shaper,
   vocoder, pitch shifter).
   **First pass (2026-10-28):** the Trio synth (three oscillators, unison, filter envelope, LFO, glide,
   drive, ten presets); presets for every built-in synth with browse arrows; Parametric EQ with its curve,
   Multiband, a beat-locked Gate and Auto-pan. FL Studio's own packs as instruments: 29 multi-sampled
   instruments and about 70 single sounds, each sample's note found from its name or by pitch detection,
   and every FL drum kit with velocity layers and alternating takes. With FL sounds on, Make a beat picks
   instruments that suit the style. Still to come: FM and wavetable synths, a slicer, transient shaper,
   vocoder, pitch shifter, favourites.
   **Second pass (2026-10-28):** an FM synth (three operators, three routings), a wavetable synth
   (morphing tables), a slicer (drop a loop, play slices by key or by step) and a vocoder that takes its
   voice from any channel. Still to come: transient shaper, pitch shifter, favourites.
3. **The brain:** a local language model that plans with a fixed set of DAW actions (add channels, write
   and edit patterns, arrange the playlist, mix, master), shows the plan, runs it, and makes it undoable;
   plus a mix check that listens to the render and explains what to fix.
   **First pass (2026-10-28):** Google's free MusicVAE and GrooVAE models now humanize drums (a drummer's
   timing and dynamics), write variations of drums or a melody (press again for the next), and play
   fills. The brain takes requests in words (Ctrl+K or Ask): "make a trap beat at 142, add 808 slides
   every 2 bars and hat rolls every 4 bars" becomes a plan you see, then runs as one undo. It's rules
   (beatlab/intent.js, 55 phrasings tested), so it's instant, offline and free; a local language model
   could later take over the sentences it doesn't understand.
   **Also (2026-10-28):** new beats get a drummer's pocket (hats accented, snares laid back in the slow
   styles, kicks tight) instead of random jitter, and an auto mix measures every part and balances it
   (on by default for new beats, and a button in the mixer).
   **Smart brain (2026-10-28):** an optional free language model (Qwen2.5 1.5B through WebLLM, about
   1 GB once, WebGPU) rewrites sentences the rules don't understand into ones they do, so it can only
   do what the brain can do, and it shows what it read. Not yet tried on a PC with WebGPU.
4. **Product:** the full landing page, installer and packaging, BeatLab's own sample library, and a licence
   review.
   **Done (2026-10-28):** BeatLab's own sample library (five kits with three takes per hit, five 808s,
   five loops, all rendered from BeatLab's synths by tools/make_samples.mjs), Install BeatLab.bat
   (Python check, Desktop and Start menu shortcuts), a website version for GitHub Pages (BeatLab's
   sounds, exports as one zip), a README with credits and licences, and the test suites in the repo.
   **Website, the whole studio (2026-10-28):** song search asks Apple directly (no server), and Connect
   FL Studio reads the visitor's own Packs folder in the browser, so FL instruments and kits work online.
   **Hackathon round (2026-10-28):** an AudioWorklet DSP engine (dsp.js, measured by test_dsp.mjs) with Time
   warp (half-time, stutter, tape stop, reverse, locked to the bar), Tune (YIN pitch to the song's key), a
   pitch shifter and a transient shaper; an acid bass; favourites; the mix doctor (doctor.js: eight measured
   rules, a score out of 100, one-click fixes; the starter beat goes from 33 to 94); humming to notes
   (hum.js); the brain learned the new effects, the doctor and humming (70 phrasings).
   **AI-native, like a code editor for beats (2026-10-29):** autocomplete (write a few notes or steps, pause,
   and the AI suggests what comes next; Tab keeps it), the brain chat (Ctrl+I: knows the project, lists what
   changed, Keep, Undo and A/B, answers questions, @mentions, edits only the selected notes), and a phone and
   tablet layout with a tab bar, then the agent that turns a loop into a full song.
   **A brain that understands producers (2026-10-29):** measured on requests typed the way producers type
   them (brain_eval.mjs, now part of `npm test`), it went from 63% to 100% of 190: complaints ("808 not
   hitting"), moods, sound swaps, sidechain, slang and typos. When it doesn't get something, it offers the
   closest things it can do.
   **A brain that can actually do things (2026-10-30):** that 100% was on requests it had been taught. On new
   ones written afterwards, the rules alone had no answer for 15 of 30, so rules can't be the whole answer.
   Now: connect a free AI (Groq or Google, your own key, no server) that reads the project and writes parts;
   conversation memory; real musical edits in edit.js; answers from the project in advice.js; piano roll
   Tools and ghosts; melodies with contours and phrase endings, drum turnarounds, new beats start mixed.
   Still to prove: a real model's musical results by ear, and the on-PC model on real hardware.
5. **Depth:** every synth voice on the audio thread for lower CPU, sends between inserts, ghost channels,
   collaboration from a shared link, a brain that learns from your past beats, and more of FL's long tail.
