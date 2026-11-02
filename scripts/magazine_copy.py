"""Editable copy for the power-rankings magazine.

The numbers in the magazine regenerate every run; this prose does not. Refresh it
when the storylines move, then rebuild:

    python3 scripts/build_magazine.py

TEAMS is keyed by Sleeper user id, so it survives team renames. Every manager in
the league needs an entry or the build stops and tells you who is missing.
Each entry has:
    kicker  - the small line above the team name
    head    - the headline over the scouting report
    body    - paragraphs, written longest-view first
    verdict - the pull quote at the foot of the page

WEEK_NOTES and FLASH sit on the standings page and are the most perishable copy
in the file. DECK is the sentence on the cover.
"""

TEAMS = {
'437632071087681536': dict(  # Linn Legends
  kicker='The best team nobody has beaten — or remembered',
  head='Still Chasing the Ring',
  body=[
    "Seven weeks, seven wins, 143.4 points a game. No team in the league is scoring more, and no roster projects better over the next three years. Only twice before has a team started a season 7-0 in this league — Linn Wildcats in 2018 and Clark's Cock Holster in 2021 — and both of them went on to win the championship.",
    "It is also the most haunted. Across ten seasons this is the winningest franchise in league history at 86-56, with eight playoff trips and three trips to the final. The trophy case is empty. Three times they have played for it all and three times they have come home with nothing, and their 7-8 playoff record is the single sharpest contradiction in the league: dominant for seventeen weeks, ordinary for three.",
    "The build is a backfield. Bijan Robinson, Jonathan Taylor, Kyren Williams and Javonte Williams give them the top running back room in the league by a wide margin, and they own the second-most draft capital on top of it. The weak spots are real — sixth at quarterback, eighth at tight end — but they are the kind of holes a team with this much ammunition fixes at the deadline.",
  ],
  verdict="If the ring doesn't come this year, it may be time to stop blaming variance."),

'442088400237883392': dict(  # Sports Team
  kicker='Best roster in the league, middling record',
  head='Loaded, and Waiting',
  body=[
    "On paper there is no better team. Sports Team holds the number one roster rating in the league for this season and the number one wide receiver room by a distance: Puka Nacua, CeeDee Lamb, Amon-Ra St. Brown and Drake London, with Josh Allen as the league's top quarterback behind them. They are second in scoring at 140.0 a game.",
    "They are 4-3. That is the story of this franchise in miniature — across Sleeper seasons they have finished 1.3 wins below what their scores earned, and they have lost two finals to go with their 2023 title. Good process, indifferent results.",
    "The one number that should worry them is draft capital: dead last in the league. Every future pick that mattered has already been spent, which is the correct way to run a roster this good, but it means the margin for error is gone. They are the best pure trader in league history at plus-274 points, so if a move is there to be made, this is the manager who finds it.",
  ],
  verdict="A championship roster with no safety net. Win now or the bill comes due."),

'442147221786324992': dict(  # Firecrotch
  kicker='Third in scoring, seventh in the standings',
  head='Robbed Weekly',
  body=[
    "Firecrotch is scoring 134.8 points a game, third in the league, and sitting at 3-4. Their weekly all-play strength of .651 says they should be comfortably in the playoff picture. Instead they have run into the wrong opponent nearly every Sunday.",
    "The roster is legitimately good and young enough to stay that way. Jahmyr Gibbs and Kenneth Walker form the second-best backfield in the league, Zay Flowers and Nico Collins are both the right side of 28, and the whole operation grades third both for this season and for the long term.",
    "History says to take them seriously in January: their nine playoff wins are the most of any team in the league, built on the 2019 title and a steady habit of showing up in the postseason. History also says to never, under any circumstance, answer their trade calls. At minus-508 points, this is the worst negotiating record in the league, more than three times the next-largest deficit.",
  ],
  verdict="The schedule is the only thing beating them. That tends to even out."),

'442764783985356800': dict(  # #2 Mizzou Fan
  kicker='The luckiest manager in league history, again',
  head='Riding the Wave',
  body=[
    "Four and three, on 123.2 points a game — a scoring rate that ranks sixth. This is not new. Across Sleeper seasons #2 Mizzou Fan has won 6.9 more games than their scoring deserved, the largest gap in the league by a factor of six, and the 2024 title came in exactly that style.",
    "There is real talent here. Ja'Marr Chase anchors a wide receiver group that ranks third, James Cook and Bucky Irving are a functional backfield, and the manager works harder than almost anyone — 333 waiver moves, second-most in the league.",
    "The problem is the calendar. At 27.4 years, this is the third-oldest starting lineup in the league, the roster drops to seventh in the long-term ratings, and the draft capital sits ninth. The core that won in 2024 is still the core, and it is getting older without being replaced.",
  ],
  verdict="The window is open and the hinges are rusting. Push now."),

'448906745809465344': dict(  # Respect
  kicker='From 0-14 to the playoff race',
  head='The Turnaround',
  body=[
    "Last season Respect lost every single game. Fourteen losses, 99 points a week, the worst season any team has put up in ten years of this league. They are 4-3 and scoring 122.5. Nothing in this magazine has changed more.",
    "The rebuild is the real thing, not a hot streak. This is the youngest starting lineup in the league at 25.9 years, built around Justin Jefferson and Joe Burrow with Jeremiyah Love, Tetairoa McMillan and Bhayshul Tuten coming behind them. The long-term rating has them fourth — no team below them in these rankings projects better.",
    "The caution flag is the track record. Respect owns the worst all-time record in the league at 53-89 and the worst draft grade of any manager at minus-227 points, which is a difficult way to build through youth. The 2016 title is a long way back. But they have never had a core this young or this good.",
  ],
  verdict="The worst franchise in league history is suddenly one of the most interesting."),

'444566878594002944': dict(  # SuhMuhFuhDihBih
  kicker='The defending champion is 2-5',
  head='Title Hangover',
  body=[
    "Twelve months ago SuhMuhFuhDihBih went 10-4 and won the championship. They are 2-5, scoring 119.4 a game, and the ratings have them sixth now and eighth going forward. The defense of the crown has gone about as badly as it could.",
    "The causes are visible from space. This is the second-oldest starting lineup in the league at 28.4 years. Christian McCaffrey turns 31 and still leads a running back room that ranks third — the one genuine strength on the roster. The quarterback position ranks tenth, dead last, and the receiving corps is seventh.",
    "Ashton Jeanty is the reason to stay patient. At 22.9 he is the youngest cornerstone on the roster and the player a retool would be built around. Whether this manager retools is another question: eight graded trades in seven years is among the quietest records in the league.",
  ],
  verdict="A champion with an old roster and a young star. Something has to give."),

'442090090840190976': dict(  # Bob
  kicker='Ten seasons, zero titles, zero playoff wins',
  head='The Quiet Build',
  body=[
    "No franchise in this league has less to show for ten years than Bob. No championships, no finals, three playoff appearances and an 0-3 record once they get there. The all-time mark of 54-88 is second-worst in the league.",
    "And yet something is happening. At 3-4 with 119.4 a game they are no longer the punchline, and the receiving corps — Jaxon Smith-Njigba, Chris Olave, Luther Burden and Carnell Tate — rates second in the league and is almost entirely under 27. The long-term rating has them sixth and climbing.",
    "They are also, quietly, the best lineup setter in the league. Bob starts 84.3% of the points available on his roster, the highest mark of any manager, leaving just 20.8 points a week on the bench while the league average sits past 28. What he does not do is work the wire: 37 waiver moves in seven years, about a tenth of what the busiest manager runs.",
  ],
  verdict="Perfect lineups, patient roster, no hardware. The first trophy has to start somewhere."),

'446310113892888576': dict(  # Linn Wildcats
  kicker='Best at acquiring talent, worst at using it',
  head='The Paradox',
  body=[
    "Linn Wildcats is the best drafter in the league at plus-288 points. The best waiver-wire operator at plus-307 net. The third-best trader at plus-160. By every measure of acquiring talent, no manager in the Midwest Dynasty League does it better.",
    "They are 2-5, scoring 113.1 a game, and rated last for this season. Across Sleeper seasons the record is 45-58.",
    "The explanation is a single statistic. Linn Wildcats starts 77.7% of the points available on their roster — the worst mark in the league — and leaves 33.6 points a week on the bench, roughly thirteen more per week than Bob. Over seven seasons that is more than 3,200 points watched from the sideline, enough to swing a dozen games. The talent arrives. It just does not always play.",
  ],
  verdict="Two titles prove the method works. The lineup card is the whole problem."),

'442057660360028160': dict(  # The NuTCRACkERZ
  kicker='Two championships, one full teardown',
  head='Playing the Long Game',
  body=[
    "At 108.8 points a game, The NuTCRACkERZ is the second-lowest-scoring team in the league, with a weekly strength of .286 that is the worst mark of any team this season. The running back room ranks tenth. This is a bad football team in 2026, and it is on purpose.",
    "They hold the most draft capital in the league at 20,607 points of value, and the long-term rating has them fifth — eight spots above where they sit today. Trey McBride is the top tight end in the league, Caleb Williams is 24, Omarion Hampton is 23, and Jordyn Tyson is 22. The pieces being gathered are all arriving at the same time, two or three years from now.",
    "They have done this before. Two championships, in 2017 and 2022, from a franchise that has never been the best regular-season team in the league. They are also 4-11 in career games decided by under five points, which is the kind of luck that cannot keep going forever.",
  ],
  verdict="The worst team in the league right now, and one of the best bets for 2028."),

'446050808375537664': dict(  # Clark's Cock Holster
  kicker='The best roster-builder in league history, in free fall',
  head='The Long Slide',
  body=[
    "For most of a decade this was the most dangerous team in the Midwest Dynasty League. An all-time record of 83-59, 132.0 points a game across Sleeper seasons, and twenty weeks as the league's highest scorer — more than anyone. In 2021 they went 12-2 and won it all.",
    "The decline since has been relentless and unbroken. Weekly strength by season: .812, .683, .762, .627, .508, .500, and now .302. At 3-4 with 107.5 points a game they are the lowest-scoring team in the league, with the oldest starting lineup at 28.5 years, the worst receiving corps, and the worst long-term rating of any roster.",
    "What is left is the skill that built it. This manager is the second-best negotiator in league history at plus-258 points across just twelve graded trades, with the fewest draft picks of anyone — a roster assembled almost entirely through deals rather than the draft. Drake Maye at 24 and Quinshon Judkins at 23 are something to build on, and the third-most draft capital gives them the means.",
  ],
  verdict="Elite trader, ancient roster, 2-6 in the playoffs. Deal your way out — again."),
}


# Cover deck, the three notes under the standings table, and the stat strip below
# them. All of these reference the current week and should be rewritten each issue.
DECK = ("Seven weeks in, one team is undefeated, the defending champion is 2-5, "
        "and the worst franchise in league history is suddenly in the playoff race. "
        "A scouting report on every roster in the Midwest Dynasty League.")

WEEK_NOTES = [
    ("The gap is real",
     "The top three teams are scoring 134 points a game or better. The bottom three are under "
     "114. There is almost nothing in between — this is a league splitting into contenders and "
     "rebuilds in real time."),
    ("Records lie",
     "Three of the four teams sitting at .500 or better are being outscored by teams below them. "
     "Firecrotch is third in scoring and seventh in the standings."),
    ("Youth moved",
     "The two youngest rosters in the league, Respect and Linn Legends, are a combined 11-3. The "
     "two oldest, SuhMuhFuhDihBih and Clark's Cock Holster, are 5-9."),
]

FLASH = [
    ("121.22", "Largest margin in league history: Clark's Cock Holster 209.00, Linn Legends 87.78, "
               "week 11 of 2022"),
    ("7&ndash;0", "Linn Legends' start, the league's first since 2021. Both previous 7&ndash;0 "
                  "starts ended in a title"),
    ("0&ndash;14 &rarr; 4&ndash;3", "Respect, one year on from the worst season any team has had "
                                    "in ten years"),
    ("20,607", "The NuTCRACkERZ' draft capital, the most held by any team in the league today"),
]

# The eight cards on the closing honours page: (label, winner, detail).
HONORS = [
    ("Best manager", "Linn Legends",
     "Outscores 67% of the league in a typical week, the highest mark of any manager, with the "
     "best all-time record at 86-56. Still has no championship."),
    ("Luckiest", "#2 Mizzou Fan",
     "Has won 6.9 more games than their scoring earned, six times the gap of anyone else — and "
     "turned it into the 2024 title."),
    ("Unluckiest", "Respect",
     "2.1 wins below what their scores deserved, including an 0-14 season in which the scoring "
     "said they should have won three."),
    ("Best drafter", "Linn Wildcats",
     "Plus-288 points against what their draft slots usually return, headlined by De'Von Achane "
     "at pick 14 in 2023."),
    ("Best negotiator", "Sports Team",
     "Plus-274 points across just five graded trades, the best rate of return in the league."),
    ("Worst negotiator", "Firecrotch",
     "Minus-508 points over eleven graded trades, winning only two of them. The largest deficit "
     "in league history."),
    ("Best lineup setter", "Bob",
     "Starts 84.3% of the points available on the roster, leaving 20.8 a week on the bench — the "
     "league's most efficient manager."),
    ("Biggest blowout", "209.00 — 87.78",
     "Clark's Cock Holster over Linn Legends, week 11 of 2022. A margin of 121.22, the only game "
     "in league history decided by more than 100."),
]
