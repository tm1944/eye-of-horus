# Inter

`InterVariable.woff2` is the upright variable Inter font (weights 100–900), downloaded from the official Inter repository:
https://github.com/rsms/inter/blob/master/docs/font-files/InterVariable.woff2

The bundled `OFL.txt` contains the SIL Open Font License. `layout.tsx` loads this local file with `next/font/local` and exposes `--font-inter`; `globals.css` applies it to the UI. Coordinates retain their monospaced font. No runtime or build-time font download is needed.
