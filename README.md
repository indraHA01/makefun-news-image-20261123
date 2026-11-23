# The World in One Page — Monday 23 November 2026

[![make.fun · news-image-20261123](https://make.fun/badge/news-image-20261123.svg)](https://make.fun/bounty/news-image-20261123?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261123)
[![rank](https://make.fun/badge/news-image-20261123/indraHA01/makefun-news-image-20261123/rank.svg)](https://make.fun/bounty/news-image-20261123/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261123)
[![reward](https://make.fun/badge/news-image-20261123/indraHA01/makefun-news-image-20261123/reward.svg)](https://make.fun/bounty/news-image-20261123?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261123)

Entry for the [news-image-20261123](https://make.fun/bounty/news-image-20261123) bounty on make.fun: a program that draws one newspaper front page summing up the world's news of **Monday 23 November 2026** and writes it to `/output/entry.png`.

## The day it sums up

- **COP31 collapses** — UN climate talks in Antalya end with no deal after the longest summit on record; the EU and others reject a final draft with no mention of fossil fuels. The first climate talks to fail since Copenhagen 2009.
- **Democrats win 258 House seats** — the biggest US House majority since 1992, as Chuck Hubbard flips a North Carolina seat.
- **Mexico seizes 'Chapo Isidro'** — the FBI most-wanted cartel boss is captured in Sinaloa; 11 killed in gun battles.
- **Kyiv hit as ship burns** — 14 missing after a Russian drone strike on the Kyiv region; a Russian cargo ship is ablaze off Finland.
- **Indonesia factory fire** — 3 dead, dozens missing after a blaze at a candy plant.
- **South Korea minister quits** — the education minister resigns over an AI exam-cheating scandal.
- **Sport** — India post a record 720/9 in the Wellington Test; Verstappen wins a chaotic Las Vegas GP; the Hunger Games prequel opens with $120M.

## How it works

`main.ts` (Node 22, standard library only) draws the page with a hand-rolled rasterizer — framebuffer, rectangles, circles, lines and polygons, a 5×7 bitmap font authored in the file, and a hand-rolled PNG encoder (zlib + CRC32). No network, no bundled image assets, no clock, no randomness: every run writes the same bytes.

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

The output is a 1024×1024 PNG, well under the 1 MiB limit. Two consecutive runs produce byte-identical output (verified by SHA-256).

## License

MIT — see [LICENSE](LICENSE).
