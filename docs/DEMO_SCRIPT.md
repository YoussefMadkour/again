# Demo script: AGAIN. at Hackyard

About **3 minutes**, one person talking, one laptop driving. The words are a guide, not a
script to read: say them your way. **Bold** is what to do on screen.

Before you start:

- Open the site (the deployed one, or `pnpm dev` with `EXPLORE_ONLY=true`).
- Load the 1946 room once, so its world is cached.
- Sound on, volume at about 60%, a mouse (not a trackpad) for the drag-to-look.
- Keep the browser full screen (⌃⌘F) with no other tabs showing.

---

## 0:00: the hook (on the home screen)

> "Everyone has a photograph they wish they could step into. A grandparent's kitchen. A room
> that doesn't exist any more.
>
> This is AGAIN. It turns an old photograph into a place you can walk into, and it's honest
> about which parts are real."

**Hover the photographs**: they swing round, coverflow style. Stop on **Luna Park** and
**drag the slider handle** across it.

> "This is Luna Park, Coney Island, around 1905. The original plate is on the left. On the
> right, we colourised it in place, pixel for pixel, and built the world from the colour
> version."

**Hover back to the 1946 living room.**

## 0:30: the crossing

> "This one's real: a coal miner's wife in Colorado, 1946, photographed by Russell Lee. She's
> holding a portrait of a man in uniform."

**Click the photograph.** Then **say nothing for about 5 seconds**, while the camera moves
toward the print and passes through it. Let the music come in.

> "We don't fade to 3D. You walk through the photograph."

## 0:50: inside

**Drag slowly to look around.** Then press **W** once or twice, gently.

> "The room is a Gaussian-splat world from World Labs' Marble. But look at her."

**Turn toward the woman.**

> "World models are bad at people: blank faces. So she's a real 3D model. Her look (face,
> hair, apron) comes from her photograph. Her body and pose come from a second model. We fit
> one onto the other, to about 2 centimetres, and the table in front of her still hides her
> legs. We never invent a face: the portraits on the wall are the photograph's own pixels."

**Click the glowing lamp.** The evidence panel opens and shows the lamp outlined in the
photo: **"observed here"**. **Press Esc.**

> "Everything you can pick up points back to where it was in the photograph."

## 1:40: the honesty

**Hold Space.**

> "Hold Space and it shows where every point came from. Warm light is what the photograph
> saw. Amber is what was inferred just past its edges. Blue is what was imagined."

**Let go. Drag the MEMORY ↔ DREAM slider** to MEMORY and back.

> "At MEMORY, anything the photo never saw fades out. At DREAM, you see the whole world the
> model imagined."

**Turn around, well past the photograph.** The overlay appears: *"You are leaving the
photographed memory."*

> "And if you walk past what the photo saw, it tells you. Beyond this point, AGAIN. is
> imagining."

**Click continue.**

## 2:20: what we add

**Turn back toward her and press M** (toggle "marble only").

> "This is what the world model made on its own." (**Press M again.**) "And this is with
> AGAIN.: her face, the portraits, the lamp. The world model is brilliant at rooms and poor
> at people and pictures. That's where we come in."

## 2:40: the close

> "Under the hood:
> - World Labs Marble builds the world.
> - Gemini reads the photograph.
> - Jev, from TypeSafe, makes the judgment calls: what becomes 3D, what matters, and no made-up
>   voices, ever.
> - SAM 3 and Hunyuan3D rebuild the objects and people.
> - ElevenLabs does the sound and the music.
>
> Built in three days.
>
> AGAIN. Walk into a memory."

**Press Esc** to lay the photograph back over the world. End on the print.

---

## If something goes wrong

| | |
|---|---|
| The world is slow to load | Keep talking over the photograph ("remembering…"). The 1946 room is baked into the app, so it loads without the network |
| No sound | Check it says **sound on** (top right). Browsers only play sound after a click, so clicking the photograph unlocks it |
| Wi-Fi dies | The 1946 room still works: it's entirely local. Skip Luna Park |
| Lost inside the room | **Esc**, or **return to photo**, goes back to the viewpoint |
| Someone wants to try their own photo | Not on the showcase (uploads are off, so nobody can spend credits). Offer the story instead: "we'd need about five minutes and $1.30 of compute" |

## Controls

| | |
|---|---|
| drag | look |
| W A S D / arrows | move |
| hold Space | what the photograph saw |
| MEMORY ↔ DREAM | fade what was imagined |
| M | marble only / with AGAIN. |
| P | photo layers on / off |
| click what glows | where it is in the photograph |
| Esc | back to the photograph |

## Questions people ask

- **"Is her face generated?"** No. The model's look comes from her real photograph. AGAIN.
  never uses AI face restoration: a made-up face of someone's grandmother is worse than a
  blurry one.
- **"How long does a new memory take?"** About five minutes for the world, then a minute or
  two for the objects and people.
- **"How much does it cost?"** About $1.26 for the world, and around 40 cents for each 3D
  object and each person.
- **"What's Jev doing?"** Small calibrated judgments over the scene description (text
  only): should this be a 3D object, a flat photo layer, or part of the room? How much does
  it matter? Would this sound contain someone's voice? Code decides what to do with the
  answers.
- **"What don't you do?"** Invent faces or voices, identify people, or pretend the imagined
  parts are real.
- **"What's next?"** Several photos of the same room, for a world that sees more. People
  seen from behind. Your own family's photographs, private by default.
