# 2026-05-12 dev batch — scan roll reconstruction

Reconstructed 2026-06-07 from the SD card import (`/Users/stout/tmp/100_FUJI`,
355 RAF frames `DSCF0011`–`DSCF0365`) by combining:
- **blue-tape seq shots** (shot BEFORE each roll, never after; sometimes forgotten),
  read from rotated 180° Quick Look thumbnails
- **capture-time gaps** (3 scanning sessions on 2026-05-18, tank groups scanned together)
- **frame counts** vs Tomu `dev_seq` 717–735

Tape protocol: seq written on blue painter's tape, photographed immediately before
its roll. If forgotten, a black frame (lens cap) sometimes marks the boundary instead.
A blank/unexposed strip in `DSCF0011`–`DSCF0012` (pure black) starts the card.

## Roll map (11 segments = 11 rolls scanned; 4x5 rolls 717–723 not scanned)

| Frames      | Seq | display_id    | Stock        | Tape      |
|-------------|-----|---------------|--------------|-----------|
| 0013–0048   | 733 | 20260415.01   | EDU 400 DX   | forgot (2 black frames) |
| 0050–0084   | 734 | 20260328.01   | NCS no.5     | ✓         |
| 0086–0124   | 735 | 20260419.01   | NCS no.5     | ✓         |
| 0126–0162   | 732 | (unassigned)  | mystery HP5  | ✓         |
| 0164–0183   | 731 | (unassigned)  | FP4 expired  | ✓ (tape 0163, scanned just before the 4.5h break) |
| 0185–0207   | 729 | 20231217.03   | Tri-X 400    | ✓         |
| 0209–0247   | 730 | 20240622.01   | Acros II 100 | ✓         |
| 0249–0264   | 727 ⚠PROV | 20240923.05   | HP5@800      | forgot (1 black frame 0248); 0265–0266 = end boundary |
| 0268–0304   | 726 | 20240810.01   | HP5@800      | ✓ (tape read "72x", curled/blurry) |
| 0306–0342   | 725 | 20240314.01   | HP5@800      | ✓         |
| 0344–0365   | 724 | 20260328.02   | Kentmere 200 | ✓         |

Session structure (2026-05-18):
- **S1 11:40–12:14**: 733 (solo, Jobo 1-reel), then Jobo 2-reel NCS pair 734/735,
  then Paterson 2-reel #2 pair 732/731.
- **~4.5h break**
- **S2 16:45–~17:00**: rest of 731, then Paterson 2-reel #3 pair 729/730.
- **~1.8h break**
- **S3 18:43–20:14**: the surviving Paterson 2-reel #1 HP5, then Paterson 3-reel
  trio 726/725/724 in descending order.

## Open questions
1. **727 vs 728** — RESOLVED PROVISIONALLY 2026-06-13. User guessed **727 (20240923.05,
   Sep)** holds the 16 scanned frames (0249–0264; 0265–0266 blank end-of-roll); **728 (20240503.02, May) was BLANK**
   and never scanned. Basis: segment content is a downtown trip — a "CITY HALL" building
   sign (frame 0253), glass towers, fire hydrant, classical colonnade, bare/wintry trees
   (lean autumn → Sep). **User may flip 727↔728 after viewing positives.** Both HP5@800,
   so the scan is identical either way; flipping is just a label swap. Also see ROADMAP
   line ~64: 727/728 flagged for old-sheet reconciliation (20240923.3 / 20230503.2).
2. **725 frame count** — RESOLVED 2026-06-13. The logged "24 exposures" was simply wrong;
   the 37-frame segment 0306–0342 is one roll. No hidden boundary.

## Not yet done
- No Tomu writes. Rolls 724–735 still `developed`, not `scanning`/`complete`.
- LR keywords not applied (user imports one roll at a time, keywording each).
- Recommended LR keyword per roll: `20260512.0NNN` (true dev date; seq is authoritative).

Raw timeline: `scan-20260512-batch-timestamps.txt` (this dir).
