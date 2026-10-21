# Changelog

## 1.6.0 — 2026-10-21

- **Set date & time** (Console top bar and *Clock & queue*, plus a macro in *Time*). You can set the game clock to a calendar date or to a Day number and time. *Move the clock* advances game time, so everything due in between happens (a jump of more than 60 days asks first). *Just relabel it* changes what the clock reads without moving anything on the schedule. The setting is the world setting `clock` (`{ mode, offset }`). Until it's set, the Console shows Foundry's calendar as before.
- **Add to the schedule** (Console *Clock & queue*, plus a macro in *Time*). These are your own reminders on the game clock: in N minutes, hours, days or weeks, or at a date and time; once or repeating; whispered to you or posted to everyone; optionally about one Agent. The schedule list shows each item's date and notes.
- **Impossible Landscapes: Night World (house rule).**
  - An *In the Night World* tickbox on the SAN test dialog, or mark Agents as inside. The test is rolled, but the loss is held in `flags.dg-ops.il.nightWorld` instead of coming off the sheet.
  - The Console roster shows the tally to the Handler with −/+ corrections and *Apply*, which takes it as one loss and clears it.
  - There's a *Night World* tile and macro for several Agents at once.
  - The Yellow Sign still adds Corruption when the held loss is above 0. Opening a Soul Bottle is never held.
- **Core:**
  - SAN pre-checks can return `defer`. The test is rolled but not applied, and the result hooks get `{ deferred: true, rawLoss }`.
  - Extensions can add fields to the SAN test dialog (`addSanDialogField`).
  - `api.clockText`, `setClock`, `setClockDialog`, `addReminder` and `reminderDialog` are new.
- 9 new scenarios (26 in all). There are 46 Handler macros.

## 1.5.0 — 2026-10-21

Impossible Landscapes campaign features, behind a switch.

- **New setting: Impossible Landscapes campaign features** in Foundry's *Configure Settings* (world, needs a reload). It's off by default. While it's off, nothing campaign-related loads. All campaign numbers are kept in `flags.dg-ops.il.*`, so switching it off and on loses nothing. Page references are to the *Impossible Landscapes* book, and the module paraphrases rather than reproducing book text.
- **Hidden Corruption (0–10, pp.17–18):**
  - Starting values (adaptation checks + Art skills at 20%+) are confirmed once.
  - Per-session caps by part (3/4/5/6), with gains and losses capped separately, a warning at the cap, and *New session*.
  - The Console roster gets a Handler-only strip with Investigate/Disengage and corrections.
  - *Who does it pick?* and a threshold check that pulls lower Agents up.
  - Beacon at 10, and Repeater at 0 SAN with Corruption 10.
  - Every Corruption card is whispered to the Handler from the Handler's client, even when a player's roll triggered it.
- **Gifts and Insights (pp.259–261):** roll 1D100 + Corruption or pick. No band repeats across the team. Stored secretly; *Reveal* whispers them to the player.
- **The Yellow Sign (p.347):** SAN 0/1D4 helplessness, once per Agent. A loss adds +1 Corruption and the compulsion to share the sign.
- **Interference (p.351):** misfortune 4D6 hours later on the game clock, chosen by Corruption: accident 1D6, illness 1D8, violence 1D10, bizarre danger Lethality 15%.
- **Tomes (pp.348–350):** nine presets that apply study time, SAN, Unnatural, an Art skill and Corruption in one step. They're also offered in *Study the Unnatural*.
- **Soul Bottles (pp.343–344):**
  - A search roll every 8 hours (or on demand).
  - Opening a bottle costs SAN 1D10/1D100. A survivor gains 1D20 SAN, +5 Corruption and a floor of 5. Hitting 0 SAN while opening it means the Agent vanishes.
  - A destroyed bottle means maximum loss on every failed SAN roll from then on.
- **Metal and porcelain (pp.338, 341):** an NPC toggle. Odd damage or Lethality rolls inflict only 1, in the attack window and on the system's damage cards.
- **11 macros** in a new *Impossible Landscapes* folder of *Ops: Handler macros* (43 Handler macros in all).
- **Core extension points** (`scripts/core/extensions.mjs`): SAN pre-check and result hooks, `maxOnFail` in the SAN loss rules, an attack damage filter, extra *Study the Unnatural* sources, and `extendConsole()`. `sanTest` takes `tags` and `maxOnFail`.
- **Tooling:** `package.json`, `tools/build-packs.mjs` (pack sources in `packs/_source`, recovered from the 1.4.0 packs), `tools/package.mjs`, an ESLint config, and new rules tests and mock-Foundry scenarios for the campaign features.

## 1.4.0 — 2026-10-21

- **NPC builder** (macro, Console → Actions): archetype (civilian, police, federal agent, soldier, criminal, cultist, cult leader, scientist, medic, blank), how dangerous, how many; name, stats (or roll 3D6), skills; weapons and armour from the system's compendiums; folder, disposition, tokens dropped in the middle of your view, Unaware. Save any build as a template. Archetype numbers are the module's own, not book statblocks.
- **Who sees a roll:** every module card and every system roll card shows Public / Private / Handler only / Blind / Self in its header.
- **The chat roll-mode selector decides.** Module rolls and the cards that report them follow it, the same as the system's own rolls. Opposed and SAN-card rolls are no longer forced private (the opposed verdict is still whispered to the Handler).
- **Team setting** (Ops settings → Team): the players' Agents, worked out from Owner permission, or a folder, or picked by hand. Used for SAN cards, Home scenes, the Delta Green Bond queue, team status, the Console and the setup guide. Template and pregenerated Agents nobody owns are left out.
- **Setup guide:** "Don't show this when I log in" on every step; the table step lists just the team, scrolls, and can show all Agents on request.
- **Handler Console redesign:** team roster on the left (portrait, HP/WP/SAN bars with the Breaking Point, conditions, what needs attention; click to act on an Agent, expand for Bonds and quick actions), game clock and priority across the top, Actions as grouped tiles, Home scene with "send to player".
- **Rules check against the Agent's Handbook (2024):**
  - Disorder causes corrected: Sleep Disorder (violence, Unnatural), Totemic Compulsion (violence), Obsession (helplessness).
  - Addiction no longer applies −20% during the craving; the penalty comes from feeding it (p.70).
  - Removed an invented "temporarily insane can't defend" rule, an invented "inhuman stat" critical rule, and a duplicate "Manic" permanent-insanity entry.
  - Wizard note fixed: bonuses cap at +40%, penalties have no limit (p.52).
  - Prone described correctly (−20% to ranged attacks against them).
  - Situational effects use the book's durations: pepper spray −20% for 1 hour, tear gas −40% for 1 hour, taser −20% for 1D20 turns, flash-bang −40% for 1D6 turns, dazzled −20% for 1D6 turns (pp.93, 96).
  - Raising illicit cash: a critical doubles 3D6 (was 6D6). Squandering: a failure hits any one Bond.
  - Pursuit "seek an edge" skills match the book's list; Junk vehicles labelled per p.93.
  - Disarm: the book has the target drop the weapon; grabbing it is offered as the Handler's call.
  - Page references corrected (illicit cash p.91, adaptation p.73, one target per attack p.54).

## 1.3.0 — 2026-10-21

Looks the part; macros instead of the Console.

- **Visual pass.** Paper textures, typefaces and dark card headers taken from the Delta Green system itself, following its Program / Cowboys / Outlaws sheet style. Chat cards mirror the system's (portrait, speaker, whisper and time in the header). Results as rubber stamps, folder tabs, a classification line on Ops windows. New icons for every module condition.
- **Macro compendiums:** *Ops: Handler macros* (31) and *Ops: Agent macros* (7), in a *Delta Green Ops* compendium folder.
- **Situational effects** with game-time durations.
- **Agent backups** to a world compendium, daily and before the Home scene ends, with restore in the Ops Kit.
- **Your roll is waiting** notices for players; **Nudge** for the Handler.
- **Combat tracker marks** for acted and guarding.
- **Team status**, **Home scene hand-out**, **damage/heal selected**, **toggle conditions** on selected tokens.
- **Keybindings:** attack window, Ops Kit, SAN test, team status.
- Settings: match the system's cards, case-file touches, player notices, Console button, tracker marks, backups.

## 1.2.0 — 2026-10-20

Table feedback pass: players roll their own dice, combat walks you through it, conditions count.

- **Attack window, step by step.** Clicking a weapon on the sheet opens it: Attack / Called shot / Pin / Disarm, then the called-shot location, then the situation as dropdowns at their defaults (target, range, visibility, attacker condition, fire mode, ammunition). Range is read from token distance; pinned, prone and unaware targets set their defaults. Shift-click a weapon to skip it. Replaces the attack panel.
- **Conditions count.** Helpless targets (bound, asleep, unconscious, ≤2 HP) are hit with no roll and can be killed outright. Stunned, pinned, unconscious and dead attackers can't attack; suppressed ones pay 1 SAN to. Targets who can't defend are hit with the reason shown. New statuses: Distracted, Aiming, Guarding, Helpless.
- **Guarding.** A melee attack, pin, disarm, Dodge or fight-back roll stands until that combatant's next turn, and every melee attack against them is checked against it: no harm if it doesn't beat it.
- **Target rows** on attack cards: token picture, name, state and the next button (Resolve, Roll damage, Kill). Blasts add a row per token in the radius.
- **Defend cards** go to the target's player in chat (Dodge, fight back with a chosen weapon and action, or take it) instead of a popup.
- **Disarm** asks the disarmer to take the weapon or knock it away; taken weapons move to the disarmer's sheet after the Handler confirms which one.
- **Players roll their own dice.** Rolls the automation needs from an Agent become Roll cards in chat for that player (the Handler can click too; rolls straight away if the player isn't connected). Setting: *Players roll their own dice*.
- **NPC rolls** setting: automatic, or a Roll button for the Handler.
- **SAN test cards.** The Handler posts one card; each player rolls their own. The Handler sees the numbers and losses; everyone sees who passed and failed. Only the loss that applies is rolled.
- **Lowering SAN by hand** runs it through the SAN pipeline (projection, insanity, Breaking Point, adaptation).
- **Opposed tests** roll from one card, privately; the verdict is whispered to the Handler.
- **Pursuit** rebuilt as a chat card that both sides roll on, round by round.
- **Dice land first.** Cards, damage and follow-ups wait for Dice So Nice; rolls on module cards are shown inline instead of being rolled again.
- Home scene pursuits started by the Handler are handed to the player to play.
- Fixed: opposed tests, interrogation and the pursuit tracker asked other clients to roll through a socket handler that didn't exist, so any roll for an actor the clicker didn't own never came back.

## 1.1.0 — 2026-10-14

Usability pass, after Cauldron of Plentiful Resources.

- **Ops Kit:** a colour-coded title-bar button on every Delta Green sheet. Status gauges, conditions explained in plain words, adaptation, quick actions, a readiness checklist with one-click fixes, and a case log. On items it configures magazine size, selective fire, explosive, disorder mapping and trigger, and Delta Green or colleague Bonds.
- **Attack panel:** weapon cards, situation choices and a live total with its breakdown. Only the fire modes that weapon can use are offered.
- **Ops settings window:** categories, plain-language descriptions, page references, presets (By the book / Light touch / Everything). Interface options per player.
- **Setup guide** on first run: automation level, team readiness, scene units.
- **Projection prompt** shows a SAN bar with the Breaking Point and says outright whether projecting can avert insanity or the Breaking Point.
- **Undo** on damage and SAN cards (Handler).
- Tooltips on every card button; rule tips and compact cards (per player).
- **Console:** *For* row to pick Agents without selecting tokens, Ops Kit links, a **How do I…** guide, settings shortcut.
- Status effects carry plain-language descriptions.

## 1.0.0 — 2026-10-14

First release, built against Foundry VTT 14 and Delta Green 2.0.1.

- Sanity: full SAN pipeline, projection onto Bonds, temporary insanity reactions, repression, talking down, Breaking Point and disorder assignment, acute-episode triggers, adaptation, permanent insanity, Delta Green Bond queue, destroying the Unnatural, WP states, sleep and addiction rules.
- Tests: opposed and group tests, fumble consequences, distraction.
- Combat: attack assistant with modifier cap, defence prompts (Dodge / fight back), damage and Lethality against protection categories, kill radius and suppression, injuries and permanent injury, pin/escape/disarm, aim, ammunition, turn reminders, initiative tiebreak.
- Hazards and medicine: falls, impacts, fire, suffocation, cold, poisons, diseases, First Aid/resuscitation, treatment and complications, recuperation, temporary stat loss, ramming.
- Pursuit tracker.
- Home scenes (all pursuits), getting fired, prosecution, money and requisition, official review, interrogation.
- Handler Console, token HUD buttons, chat card actions, macro API.
