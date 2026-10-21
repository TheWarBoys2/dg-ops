# Delta Green: Ops Automation (`dg-ops`)

Rules automation for the **Delta Green** system (`deltagreen` **2.0.1**) on **Foundry VTT v14**. It's built on top of the system rather than replacing it: it uses the system's own roll classes, chat cards, Bonds, motivations/disorders, adaptation boxes, Active Effects, exhaustion and Rest button. It adds the procedures the system leaves to the Handler.

Page references are to the *Agent's Handbook* (2024 printing).

> **Status:** v1.6.2. The rules engine has unit tests (21), and every flow, window included, has been exercised against a mock Foundry/Delta Green runtime (56 scenarios). The new Impossible Landscapes features have their own rules tests and mock-Foundry scenarios (see *Development*). Rules and page references were checked against the 2024 Agent's Handbook. It has **not yet run in a live Foundry world**. Try it in a scratch world first (see *First run checklist*).

---

## Install

1. In Foundry: **Add-on Modules → Install Module**, paste this into *Manifest URL* and click Install:
   `https://github.com/TheWarBoys2/dg-ops/releases/latest/download/module.json`
   Foundry will then offer updates whenever a new release is published. (Or download `dg-ops.zip` from the [Releases page](https://github.com/TheWarBoys2/dg-ops/releases) and unzip it into `Data/modules/dg-ops/`.)
2. Enable **Delta Green: Ops Automation** in your world.
3. As Handler, follow the setup guide that opens. You can run it again from Ops settings.

The manifest pins Foundry 14 and Delta Green 2.0.1 exactly (minimum = verified = maximum). Bump them after you've checked a new system release.

## Where things live

The first time the Handler loads the world, a four-step **setup guide** opens. It picks how much to automate, checks each Agent, and checks the scene's distance units.

| Entry point | Who | What |
|---|---|---|
| **Ops button** in every sheet's title bar | Handler, and players on their own Agents | The **Ops Kit**, inspired by CPR's Medkit. The button turns green, amber or red with readiness. **Status:** HP/WP/SAN gauges with the Breaking Point marked, every condition explained, adaptation boxes, quick actions. **Readiness:** what's automated, what isn't, and one-click fixes. **Case log:** SAN incidents, injuries, reviews. On items, it sets how the module treats them: magazine size, selective fire, explosive, disorder mapping and trigger, Delta Green or job-colleague Bonds. |
| **Attack window** (click any weapon on a sheet; also the token HUD crosshairs and the Kit) | Everyone | Step by step: Attack / Called shot / Pin / Disarm, then the situation as dropdowns at their defaults, the targets' conditions, and the final chance with its breakdown. Shift-click a weapon to skip it. |
| **Roll cards in chat** | Players (Handler can click for anyone) | When the automation needs a roll from an Agent, it doesn't roll it for them: a card with a Roll button goes to chat. SAN tests, opposed tests, defences, pursuits and group tests all work this way. |
| **Chat card buttons** | Owner / Handler | Every button has a tooltip saying what it does. Damage and SAN cards get a Handler-only **Undo**. |
| **Macro compendiums** (*Delta Green Ops* folder in the Compendium tab) | Handler / players | **Ops: Handler macros** (43, including the NPC builder, in folders: Sanity, Rolls, Combat, Hazards & medicine, Between operations, Time, Records, Tools, Impossible Landscapes) and **Ops: Agent macros** (Attack, Aim, Reload, Take cover, Escape a pin, Repress, Ops Kit). Drag them to the hotbar. Everything the Console does is here. |
| **Handler Console** (token controls → folder icon; can be hidden) | Handler | Team at a glance, Tools (with a *For* row to pick Agents without selecting tokens), Home scene, Queue & clock, and a **How do I…** guide. |
| **Ops settings** (Configure Settings → Delta Green Ops, or the sliders in the Console) | Handler; players see interface options | Settings grouped by area in plain English, with page references and three presets: *By the book*, *Light touch*, *Everything*. |
| `game.modules.get("dg-ops").api` | Macros | Every flow below (see *API*) |

---

## Look

The module dresses itself in the Delta Green system's own materials: its stained-paper textures and typefaces, near-black ink, and dark header bars like the system's chat cards (with the speaker's portrait). The paper and body typeface follow the system's **sheet style** setting: *The Program* is clean grey stock in Public Sans; *The Cowboys* yellowed paper in Special Elite typewriter; *The Outlaws* yellowed paper in Public Sans. Results are rubber stamps; Ops windows carry a classification line. Module conditions have their own icons. All of it can be turned down in Interface settings.

## Quality of life

- **NPC builder** (Handler macro or Console): archetype and threat level, stats and skills, weapons and armour from the system compendiums, tokens on the scene, templates you can save. The archetypes' numbers are the module's own rough guides.
- **Team** (Ops settings → Team): the module knows which Agents are the players', from Owner permission by default, or a folder, or a hand-picked list.
- **Who sees a roll:** each card header says Public, Private, Handler only, Blind or Self. The roll-mode selector above the chat box decides for module rolls, as it does for the system's.

- **Situational effects** (macro): pepper spray / taser −20%, tear gas / stun grenade −40%, intoxicated, sedated, darkness, or your own, with a duration that runs on game time and wears off by itself.
- **Agent backups** in a world compendium (*Ops: Agent backups*): automatically once a day when the Handler logs in and before a Home scene ends, or on demand. Keeps the newest 5 per Agent (configurable). Restore from the Ops Kit's Case log; the state just before a restore is backed up too.
- **Your roll is waiting:** players get a notice and a highlighted card when a Roll, Defend, SAN or Pursuit card is theirs. The Handler gets a **Nudge** button on cards still waiting for a player.
- **Combat tracker marks:** who has acted (or defended) this round, and whose melee roll still stands (the Handler sees the number).
- **Team status** (macro or keybinding): HP, WP, SAN, Breaking Point and conditions for everyone, whispered to the Handler.
- **Home scene hand-out** (macro): pick a pursuit per Agent, or let each player choose; each player plays theirs from a card.
- **Damage / heal selected**, **toggle Unaware / Helpless / Distracted** on selected tokens.
- **Keybindings** (Configure Controls → Delta Green Ops): Shift+A attack window, Shift+K Ops Kit; SAN test and Team status for the Handler (unbound by default).

## Features

### Sanity (pp.66–75)

- **SAN test cards** (Console → SAN test): one card with a row per Agent. Each player clicks **Roll SAN** for their own Agent (the Handler can click for anyone who's away; NPCs roll themselves, or wait for the Handler, per the *NPC rolls* setting). The Handler sees each roll and loss; everyone sees who passed and who failed.
- **Lowering SAN by hand** (typing a lower number on an Agent's sheet, or the token bar) runs as a SAN loss: projection is offered and insanity, the Breaking Point and adaptation are checked. Raising SAN is left alone. Undo on the card puts it back.
- **Full SAN pipeline** (`api.sanTest`, the SAN card, or *Apply SAN loss* on any SAN roll from the sheet). Only the loss that applies is rolled, after the SAN roll has landed:
  - Critical success loses the minimum; a fumble loses the maximum.
  - Per-victim violence (+1 per extra victim, capped).
  - Adapted Agents succeed automatically against that kind of trauma.
  - All of the p.67 table is built in as presets.
- **Projection onto a Bond.** The player is asked before the loss lands and is shown whether it would cause temporary insanity or reach the Breaking Point. It spends 1D4 WP; if WP stays ≥1, the loss is reduced and the Bond takes the same damage.
- **Temporary insanity** (5+ in one roll):
  - Applies a status and offers Flee / Struggle / Submit; Flee counts down CON turns, then leaves the Agent exhausted.
  - **Repress** (1D4 WP + Bond, then SAN) and **Talk down** (Psychotherapy; the therapist rolls 0/1 SAN if the trauma was unnatural).
  - Optional Insight rule (+1D6% Unnatural).
- **Breaking Point:**
  - Resets BP to SAN − POW and logs a pending disorder.
  - Prompts the player to cross out a motivation.
  - The Handler assigns the disorder from the catalogue (★ marks those typical for the cause).
- **Disorders** are system motivation items carrying an Active Effect that only applies during an acute episode (the system already suppresses it otherwise):
  - Anxiety / OCD: −20% to everything.
  - Ligyrophobia / Enclosure: −20% SAN.
  - Depersonalization: −20% skills and stats.
  - Totemic: −10%.
- **Acute episodes trigger automatically** on 2+ SAN loss, or on insanity / Breaking Point for Conversion, DID and Fugues. Repress buttons appear on the card.
  - **Depression** costs 1D4 WP per test during an episode.
  - **Sleep disorder** forces a SAN roll to sleep.
  - **Addiction** has a 24-hour clock plus a *Feed addiction* button.
  - A therapy critical **cures** a disorder; it can relapse when the next disorder arrives.
- **Adaptation:**
  - The three boxes tick automatically. Insanity resets them; reaching the Breaking Point also resets them by default (configurable, per the book's example).
  - Adapting to violence costs 1D6 CHA (the system shifts every Bond with it). Adapting to helplessness costs 1D6 POW.
- **Permanent insanity** at 0 SAN: one click hands the Agent to the Handler.
- **Delta Green Bonds (p.37).** Temporary insanity, new disorders, incapacitation and deaths queue a catastrophe. *After the crisis*, the Console rolls everyone's SAN. On a failure it creates or deepens teammate Bonds and charges the other Bonds.
- **Destroying the Unnatural** restores the lowest possible loss to each Agent involved, capped at 99 − Unnatural.
- **Willpower:**
  - WP 1–2 adds an *Emotional breakdown* effect (−20% to all tests).
  - At 0 WP every test fails, SAN included.
  - Rest is limited to once per 24 game hours.
  - A sleeplessness SAN test is required after insanity or a new disorder (sedatives give +20%, then a hangover).
  - *+1 WP* for playing up a motivation.

### Tests (pp.42–45)

- **Players roll their own dice.** When something the Handler (or another player) did needs a roll from an Agent, a Roll card goes to chat for that Agent's player; the flow carries on once they click. The Handler can click it too. If the player isn't connected, it rolls straight away. Switch off with *Players roll their own dice*.
- **Dice land first.** Results, damage and follow-up cards wait for Dice So Nice to finish.
- **Opposed tests** use the p.45 table: a critical beats a success, the higher success wins, and what happens when both fail is configurable. Both sides roll from one card; the rolls are private to each roller and the Handler, and the verdict is whispered to the Handler. There's also a "nobody rolls, higher rating wins" mode.
- **Group tests** ("Who rolls?"): the highest rating, the lowest, or everyone, from one card.
- **Fumbles** whisper the Handler one-click consequences: physical strain, emotional burnout, alienation, exhaustion, **Distracted** (a status: −20% to the next test, then it clears), confusion. Weapon fumbles add misfire, dropped weapon, friendly fire, and stumbling.

### Combat (pp.50–60)

- **Attack window**, opened by clicking a weapon on the sheet:
  1. **Action:** Attack, Called shot, Pin or Disarm (pin and disarm only on Unarmed Combat).
  2. **Called shot:** partly or mostly covered, plus the optional Stun / Flesh wound / Head shot.
  3. **Situation:** dropdowns for target movement, range (worked out from token distance and the weapon's range), visibility, the attacker's condition, fire mode and ammunition, all at their defaults. A pinned target defaults to +20% in melee and a prone one to −20% at range; an unaware target before the fight starts is a surprise attack.
  - The targets are listed with what the automation knows about them: helpless, pinned, prone, unaware, guarding, cover, armor.
  - Conditions on the attacker are included: Aiming +20%, Distracted −20%, sheet effects. Stunned, pinned (offers *Try to escape*), unconscious or dead attackers can't attack; suppressed attackers choose cover, prone, or 1 SAN to attack anyway.
  - **Bonuses cap at +40% before penalties.**
- **Target rows on the attack card.** Each target gets a row with its token picture, name, state and the next button: **Resolve**, then **Roll damage** (or **Roll Lethality**).
  - **Helpless targets** (bound, asleep, unconscious, or at 2 HP or less) are hit without a roll, and the attacker can **Kill** outright (p.55).
  - **Guarding:** an Agent's melee attack, pin, disarm, Dodge or fight-back roll stays in force until their next turn (p.54, combat only). Any melee attack against them is checked against that roll; if it doesn't beat it, no harm.
  - **Defend card** for player targets: Dodge, Fight back (attack, called shot, pin or disarm, choosing the weapon), or take it. Against gunfire, Dodge only scrambles to cover (its armor then applies). NPCs defend by themselves (the better of Dodge and their best melee weapon) or wait for the Handler.
  - Targets who can't defend (surprised, stunned, pinned, busy pinning, insane, already acted this round) are hit with the reason shown.
  - **Pin** pins the target and marks the pinner. **Disarm** asks the disarmer to take the weapon or knock it away; if taken, the Handler confirms which weapon and it moves to the disarmer's sheet.
  - Winning a fight-back turns the defender's action on the attacker, with its own row.
- **Damage and Lethality against protection categories:** Fragile / Exposed / Cover / Huge / Transcendent.
  - Body armor doesn't help against a successful Lethality roll. Cover makes the Lethality roll fail automatically.
  - AP −5; hollow points double armor.
  - A critical doubles damage, or doubles both the Lethality rating and its fallback damage.
  - STR damage bonus applies to melee.
- **Kill radius:**
  - *Resolve the blast* adds a row for every token within the radius (scene units = metres).
  - Each row gets its own Lethality roll. Explosive AP applies only to the primary target.
  - Optional NPC "mooks just die" shortcut.
- **Suppression.** Everyone aware inside the radius is Suppressed (Agents adapted to violence are exempt). On their turn, and in the attack window, they choose cover, prone, or act anyway for 1 SAN.
- **Damage consequences:**
  - Stun when one hit takes half or more of current HP, with CON×5 to recover on the stunned combatant's turn.
  - Unconscious at ≤2 HP; dead at 0, with the time of death recorded for resuscitation.
  - **Permanent injury** check: the Handler picks a stat, reduced by the lowest d10 of the failed roll (minimum 3). An optional rule gives crippled / blinded / deafened effects instead.
  - Injury SAN tests are offered once per type per fight: shot or stabbed 0/1D4, ≤2 HP 0/1D6, permanent injury 0/1D6.
- **Also:**
  - Pin / Escape / Disarm.
  - Ammo tracking from the weapon's capacity, plus Reload.
  - Turn reminders for stunned, pinned, suppressed, insane and fleeing combatants.
  - DEX initiative with an optional tiebreaker.

### Hazards, medicine, vehicles (pp.55, 60–63, 95)

- **Hazards:**
  - Falls (dice up to 3 m, then Lethality 1%/m, with a stun check).
  - Impacts (10% per 40 km/h, doubled into a wall).
  - Fire (per-turn damage, catching fire, half damage until put out).
  - Suffocation (CON×5 turns of breath, then per-turn CON tests).
  - Cold (endurance by preparation, CON loss every 5 minutes, warming up).
- **Poisons and diseases.** Book tables are included, run on game time, and support antidotes, hospitalization (+20%) and persistent-disease resurgence. While sick, no HP are regained.
- **Healing:**
  - **First Aid** works once per injury (1D4; 2D4 on a critical; a fumble deals 1D4) and handles resuscitation within CON minutes of death.
  - **Treatment** once per week, with complications: strenuous tests deal 1D4 until HP are full.
  - **Recuperation** once per day, automatic for patients marked as resting.
  - Temporary stat loss heals 1 point per day.
- **Ramming and collisions**, including passenger damage and seat belts. Vehicles at half HP are flagged as needing a Drive test.
- **Pursuit card** (pp.45–46). The Handler picks both sides, the skill, speed and help; the card goes to chat. Each round both sides choose and roll on the card (chase, seek an edge with Alertness/Navigate/Stealth/Survival/Search, or attack instead). Players roll their own side; NPC sides roll themselves. When both have rolled, the meter moves and the next round opens.
  - Wins needed 1–3; wins cancel; a critical counts as two wins and a fumble as two failures.
  - The lower failure wins when both fail.
  - Seek an edge (+20/+40); Fast/Slow/Junk vehicles; help bonuses.
  - Air vs surface automatically outruns.
  - A driver who attacks forfeits the exchange.

### Between operations (pp.78–91, 168)

- **Home scene** (Console tab):
  - A "What changed" list per Agent: SAN lost, damaged and broken Bonds, pending disorders, permanent injuries, pending reviews.
  - All ten pursuits are automated, plus the optional illicit-cash pursuits.
  - Gains are capped at POW×5 and at 99 − Unnatural, and Bond costs only fall on non-Delta Green Bonds.
  - **End Home scene** clears the damaged-Bond marks.
- **Getting fired and prosecution:**
  - Optional Law roll first, then the Luck roll; acquittal or conviction.
  - SAN loss, and a CHA test for every Bond (−20% for job colleagues).
- **Gear and money:**
  - "Do we have it?", official requisition (priority, delivery time, official review), own money, asking a Bond, black market, an illicit-cash ledger, and crafting.
  - Official review happens at the Home scene, with repercussions scaled to the expense.
- **Interrogation:**
  - Persuade vs Persuade, with the subject paying 1D6 WP to resist.
  - Torture and "enhanced" approaches apply their damage, SAN and modifiers to both sides.
  - Truth drugs: on a failed Pharmacy roll they become a 5% poison. Alcohol gives the subject a CON test.

### Impossible Landscapes (optional campaign features)

Switch on **Impossible Landscapes campaign features** in Foundry's own *Configure Settings → Delta Green: Ops Automation* (it needs a reload). While it's off, none of it loads: no hooks, no Console column, no buttons, no styling, and the macros in the *Impossible Landscapes* folder just say it's off. Every number lives on the Agents (`flags.dg-ops.il.*`), so switching it off and on again loses nothing. Page references here are to the *Impossible Landscapes* campaign book. The module paraphrases; it reproduces no book text, tables or statblocks.

- **Corruption, 0–10 (pp.17–18).** It's hidden: every card about it is whispered to the Handler, including ones a player's own roll sets off. (The number sits in actor flags, so a player who digs through their actor's data could find it.)
  - **Starting Corruption:** one dialog counts +1 per checked adaptation box and +1 per Art skill at 20%+, and you confirm it once.
  - **Per-session cap:** pick the current part in *Configure Settings* (Night Floors 3, Secret Faces 4, Map of Skin 5, End of the World 6). Gains and losses are capped separately, and you get a warning when an Agent hits the cap. **New session** resets it.
  - **Console:** each roster card gets a Corruption strip (Handler only) with pips, *Investigate* (+1) and *Disengage* (−1), which count toward the cap, plus −/+ corrections, which don't. It also shows the session's movement and tags for Beacon, Repeater, Floor 5, a destroyed bottle, the Yellow Sign and Gifts.
  - Rules that set Corruption directly (a tome, the Yellow Sign, a threshold, a Soul Bottle) aren't capped, but they're counted and they warn.
  - **Who does it pick?** The highest Corruption, with ties going to the lowest SAN, from the Agents on the scene.
  - **Threshold:** enter a minimum to see who experiences a place. If anyone qualifies, the whole group does, and the others rise to the threshold.
  - **Beacon** at 10. **Repeater** if an Agent hits 0 SAN at Corruption 10.
- **Gifts and Insights (pp.259–261).** Roll 1D100 + Corruption for each column, or pick. Bands never repeat across the team: a taken band moves to the nearest free one. They're stored as Handler-only flags, and **Reveal** whispers them to the player.
- **The Yellow Sign (p.347).** A SAN 0/1D4 helplessness card. Once an Agent has failed against it, it no longer applies to them. Losing SAN adds +1 Corruption and whispers the urge to share the sign to the player, with a *They've shared it* button.
- **Interference (p.351).** If the operator steps out of the circle, misfortune is scheduled 4D6 hours later on the game clock. When it lands, their Corruption decides what it is: 2 or less is an accident (1D6), 3 an illness (1D8), 4–7 violence (1D10), 8+ a bizarre danger (Lethality 15%).
- **Tomes (pp.348–350).** Nine presets: *Le Roi en jaune*, the Red Book, *Libro Secretorum Manifesta*, the Philco teleplay, *Her Grey Song*, *A Song Before Travel*, the Phantom Sayeth scrapbook, *Hygromanteia* and *The Imperial Dynasty of America*. Each one applies the SAN cost, Unnatural, one Art skill (or Occult) and Corruption in one step. They also appear in the Home scene's *Study the Unnatural*.
- **Soul Bottles (pp.343–344).** Roll 1D100 + Corruption now, or every 8 hours of game time until you stop it. Finding their own bottle offers *Open it* (SAN 1D10/1D100) or *Destroyed unopened*.
  - Someone who opens it and stays above 0 SAN gains 1D20 SAN and +5 Corruption, and can never drop below 5 again.
  - Someone who opens it and hits 0 SAN vanishes.
  - A destroyed bottle means every failed SAN roll takes the maximum loss from then on.
- **Metal and porcelain (pp.338, 341).** Toggle it on the Clockwork Child or Marionette tokens. An odd damage roll or an odd Lethality roll then inflicts only 1, both in the attack window and on the system's damage cards.
- **Night World: hold the SAN loss (house rule).** The SAN test dialog gets an *In the Night World* tickbox. When it's ticked, the test is rolled as usual (players still see pass or fail), but nothing comes off the sheet. The loss is added to that Agent's Night World tally, and only the Handler sees the number. You can also mark Agents as *in the Night World* (Console → Night World), and then every SAN test they take is held, with or without the tickbox.
  - The Console roster shows the tally (Handler only) with −/+ to correct it and **Apply**. Apply takes the whole tally as **one** SAN loss, so 5+ can mean temporary insanity and the Breaking Point counts. It then clears the tally and marks them as out.
  - The *Night World* tile and macro open a dialog for several Agents at once: see the recent entries, change the numbers, pick the category it's applied as, and apply.
  - What players see: only pass or fail. The SAN card doesn't show the loss in play, the loss dice are rolled for the Handler only, and the held number goes to the Handler. This is the setting *Impossible Landscapes: Night World SAN tests show players only pass or fail* in *Configure Settings*, which is on by default.
  - Fixed losses (a tome's flat SAN cost, for instance) and opening a Soul Bottle aren't held. Held losses don't count toward violence or helplessness adaptation, because they're applied as one lump.

Not included: clown heights, fire effects, the Gold Bug, the Coquelicots Mask, handouts and statblocks. Melonia, the King's aura, Bond symptoms, fugitive heat, NPC archetypes and a campaign visual theme may come later.

### Game clock and schedule

The Console's top bar and *Clock & queue* tab show the game clock. **Set date & time…** sets it, either to a calendar date (for example Sat 14 Mar 2026, 23:00) or to Day 1, Day 2 and so on. There are two ways to set it:

- **Move the clock:** game time passes (or goes back), and everything scheduled before the new time happens, including poisons, healing, daily upkeep and your own reminders. A jump of more than 60 days asks first.
- **Just relabel it:** the clock now reads that date and time, but nothing on the schedule moves. Use this the first time, to say when the operation starts.

The clock is kept by the module (game time plus an offset). Until you set it, the Console shows Foundry's own calendar as before.

**Add to the schedule…** puts your own items on the game clock: a title and notes, *in* so many minutes, hours, days or weeks or *at* a date and time, repeating or once, either whispered to you or posted to everyone, and optionally about one Agent. When it comes up, it posts a card. Scheduled items show their date under the countdown, and you can cancel them from the list. Both are also macros in the *Time* folder.

### Already in the system, so left alone

Skill improvement rolls, the exhaustion / stimulant / rest buttons (Rest is wrapped, not replaced), Bond +/- buttons, Bonds following CHA, the acute-episode toggle, Breaking Point reset, Luck rolls and the character wizard.

---

## Settings

**Hide the possible SAN loss from players** (Ops settings → Sanity & Bonds, off by default) does the same for every SAN test. Cards don't show what's at stake (for example 1/1D6), and the loss dice are rolled for the Handler only. Players still see what they actually lost once it lands.

Every automation can be switched off individually in the Ops settings window (Sanity & Bonds · Tests · Combat · Medical & hazards · Downtime · Interface). Defaults follow the book. The Interface options cover the Ops button, letting players open their own Kit, rule tips on cards, compact cards and Undo. The judgement calls are configurable:

- Whether temporary insanity checks the loss before or after projection (default: after).
- Whether the Breaking Point resets adaptation (default: yes, per the example on p.74).
- What happens when both sides fail an opposed test (default: Handler decides).
- Whether NPC rolls happen automatically or wait for the Handler's click, whether players roll their own dice, prompt timeout, initiative tiebreak, and the optional critical-hit and permanent-injury rules.

The system's *Keep Sanity Private* setting is respected: SAN cards are whispered to the owner and the Handler.

## API

```js
const ops = game.modules.get("dg-ops").api;
ops.openConsole();
ops.sanTest({ actor, successLoss: "1", failureLoss: "1D8", category: "unnatural", source: "The thing in the walls" });
ops.sanDialog(canvas.tokens.controlled.map(t => t.actor));          // posts a SAN card
ops.sanGroupCard(actors, { successLoss: "0", failureLoss: "1D6", category: "unnatural", source: "The corpse" });
ops.attackAssistant(actor, { itemId });   // the attack window
ops.startChase({ pursuer: { actor: a, skill: "drive", speed: "normal", aid: 0 }, quarry: { actor: b, skill: "drive", speed: "fast", aid: 0 }, required: 2 });
ops.applyDamage(actor, 7, { source: "Shrapnel", attack: true });
ops.startPoison(actor, "sarin");          // spider, badDrug, arsenic, venom, phosgene, cyanide, sarin, ricin
ops.startDisease(actor, "ebola");         // meningitis, pneumonia, gangrene, plague, hiv, ebola
ops.hazardDialog([actor]); ops.medicalDialog([actor]);
ops.opposedDialog(a, b); ops.groupDialog([a, b, c]);
ops.runPursuit(actor, "therapy");         // fulfill, nature, newBond, therapy, motivation, specialTraining, stayOnCase, improve, studyUnnatural, raiseCash, squander
ops.firedFlow(actor); ops.prosecutionFlow(actor);
ops.requisitionDialog(actor); ops.interrogationDialog();
ops.openChase();
ops.effectDialog(); ops.applySituationalEffect(actor, { preset: "gas", minutes: 5 });
ops.damageDialog(); ops.healDialog(); ops.toggleCondition(ops.STATUS.helpless);
ops.teamReport(); ops.homeSceneDialog(); ops.afterTheCrisis();
ops.backupAll(); ops.backupActor(actor); ops.restoreBackup(actor, backupId);
ops.clockText(); ops.setClockDialog(); ops.reminderDialog();
ops.setClock({ to: Date.parse("2026-03-14T23:00:00Z") / 1000, mode: "date", move: false });  // relabel; move: true advances game time
ops.addReminder({ title: "The cult moves the body", notes: "Warehouse 9", delay: 6 * 3600, every: 0, show: "gm" });  // or at: <worldTime>

// Only when Impossible Landscapes campaign features are on:
const il = ops.il;
il.corruption(actor); il.adjust(actor, +1, { reason: "Read the letter" });   // { rule: true } skips the cap, { correction: true } isn't counted
il.startingDialog(); il.newSession(); il.whoDoesItPick(); il.thresholdDialog(); il.threshold(actors, 5);
il.giftsDialog(actors); il.revealGift(actor);
il.yellowSign(actors); il.interference(actor); il.readTome(actor, "redBook");
il.bottleSearch(actors); il.openBottle(actor); il.destroyBottle(actor);
il.toggleMetalPorcelain(npcs);
il.nightWorld.of(actor);                    // { inside, held, log }
il.nightWorld.hold(actor, 3); il.nightWorld.setInside(actor, true); il.nightWorld.apply(actor); il.nightWorld.dialog(actors);
ops.sanTest({ actor, successLoss: "0", failureLoss: "1D6", source: "The Night Floors", tags: [il.nightWorld.TAG] });   // held, not applied
```

## How it hooks in (for maintenance)

- **Roll classes** are taken from `CONFIG.Dice.rolls` and patched non-destructively:
  - `isSuccess` fails everything at 0 WP.
  - `rollTargetModifier` adds aim and distraction.
  - `effectiveTarget` caps attack bonuses.
  - `DGRoll#toMessage` writes `flags.dg-ops.roll` (outcome, actor, item, targets, context) and runs post-roll handlers.
  - Results are frozen at that point, so clearing one-shot modifiers afterwards can't change a roll that's already been made.
- **Permissions.** Owners act directly. Anything else goes to the active Handler over the module socket. Prompts appear on the owning player's screen and time out (default 60 s) to the safe choice.
- **Roll requests** (`scripts/core/requests.mjs`): roll cards, Defend cards and group cards keep their state in chat-message flags, so they survive a reload. Each click is claimed through the Handler's client first, so two people can't roll the same row.
- **Sheet rolls.** `processRoll` on the Delta Green actor sheets is wrapped so weapon clicks open the attack window. The item sheet's own roll button and modules that roll items directly (e.g. Token Action HUD) still roll the system's way; their cards get target rows all the same.
- **State** lives in `flags.dg-ops.*` on actors, items and tokens, plus three hidden world settings (catastrophe queue, schedule, operation priority).
- **Extension points** (`scripts/core/extensions.mjs`) keep the core campaign-agnostic: a SAN pre-check (skip a test, or take the maximum on a failure), a SAN result hook, a damage filter on attacks, extra sources for *Study the Unnatural*, and `extendConsole()` for roster strips, tiles and actions. With nothing registered they do nothing. Campaign code lives in `scripts/campaigns/<name>/` and its `init()` is called from `main.mjs` only when its setting is on.
- **Game time** drives poisons, diseases, cold, sleep, addiction, temporary stats and recuperation. A daily upkeep event is scheduled automatically. Advance time from the Console or any calendar module.

## First run checklist

1. In a scratch world with Delta Green 2.0.1, create two Agents (with Bonds) and an NPC, and put them on a scene.
2. Console → Tools → **SAN test** on two Agents: check the card appears, each player can click their own row, the projection prompt appears on the player's screen, and the dice land before the result.
3. As a player, target the NPC and click a weapon on the sheet: walk through the attack window, then click **Resolve** on the card's target row and roll damage. Then have the NPC attack an Agent and check the Defend card reaches the player.
4. Throw a grenade into a group: *Resolve the blast*, check the rows and the Suppressed status.
5. Type a lower SAN on an Agent's sheet: check it runs as a SAN loss.
6. Console → Queue → **+1 day**: check temporary stat recovery and any scheduled events fire.

If something fails, the browser console logs lines prefixed `dg-ops |`.

## Development

```bash
npm install          # Foundry CLI 3.0.4 and ESLint
npm test             # rules unit tests + mock-Foundry scenarios
npm run lint
npm run build:packs  # macro compendiums from packs/_source (the IL macros are defined in tools/build-packs.mjs)
npm run package      # builds the packs, then dg-ops.zip (no tests, no sources, no node_modules)
```

**Releasing:** bump `version` in `module.json` (and `package.json`), update the `download` URL in `module.json` to the new tag, and merge to `main`. `.github/workflows/release.yml` sees a version with no release yet, runs the tests, builds the zip and publishes the release (tag included) with `dg-ops.zip` and `module.json`. It can also be run by hand from the Actions tab.

`test/rules.test.mjs` covers the pure rules. `test/scenarios.mjs` runs the module's real code against `test/mock-foundry.mjs`, with scripted dice and a socket that hands messages between the Handler and a player in one process. Both started with the Impossible Landscapes work in 1.5.0. The older suites (21 rules tests and 56 scenarios) weren't in this repository, so they need adding back alongside these. `packs/_source` was recovered from the compiled 1.4.0 packs, and a round trip through the CLI matches it.

`scripts/rules/` (and `scripts/campaigns/*/rules.mjs`) is pure and has no Foundry dependency. `scripts/core/` is the Foundry glue. `scripts/features/` holds the automation flows, and `scripts/apps/` the Console and Pursuit windows.

## Licence

MIT. Unofficial fan content. Rule summaries are paraphrased; no rulebook text is reproduced. Delta Green is a trademark of the Delta Green Partnership.
