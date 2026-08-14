# assets/ — package payload blobs

Large binary payloads, one directory per package (`assets/<name>/…`), each
referenced by `bin:` entries in `packages/<name>.json` and resolved against
THIS repo's root by mkpkg's `--defs` seam. Provenance and licensing are
recorded here per file — only redistributable content is allowed (the comguc
ROM guard scans every payload built from this repo).

| File | What / why | Source | License |
|---|---|---|---|
| `font-unifont/unifont-15.0.06.ttf` | `font-unifont` package payload: GNU Unifont, full-BMP bitmap-traced coverage (57087 code points incl. all CJK) — the recommended "everything renders" install. | `ftp.gnu.org/gnu/unifont/unifont-15.0.06/`, fetched 2026-07-19. 15.0.06 is the LAST TrueType build — 15.1+ ships only CFF `.otf`. | Dual SIL OFL 1.1 / GPLv2+ with font-embedding exception (`COPYING-unifont.txt`) |
| `font-noto-cjk-mono/NotoSansMonoCJKjp-VF.ttf` | `font-noto-cjk-mono` package payload: real CJK quality, family-consistent with the Noto base baked into the gucOS image. Variable font; the default instance (Regular) is what freetype renders. | `github.com/notofonts/noto-cjk` `Sans/Variable/TTF/Mono/`, fetched 2026-07-19. The variable TTF is the ONLY TrueType-flavored official build (static OTF/OTC are CFF) — hence 35 MB instead of the ~16 MB static file. | SIL OFL 1.1 (`LICENSE-NotoCJK.txt`) |

SHA-256 (as fetched; both files migrated byte-identical from c-compiler
`vendor/fonts/` at #615):

    9282b6eff54eeca2e7f58c9a40a91049bd219f3e6a45fbee8eba013379b9af3a  font-unifont/unifont-15.0.06.ttf
    9a91b2f42ad958fd4295586809f85366f0afa020b85ac70b39916c25bc5cda15  font-noto-cjk-mono/NotoSansMonoCJKjp-VF.ttf
