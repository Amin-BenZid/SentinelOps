# Rapport de stage - SentinelOps (LaTeX)

## Compile
- **Overleaf**: upload the zip (New Project > Upload Project). Compiler: pdfLaTeX (default) or XeLaTeX. Recompile.
- **Local (MiKTeX / TeX Live)**: `latexmk -pdf main.tex`
  or `pdflatex main` -> `bibtex main` -> `pdflatex main` x2.

## Fill in
1. `main.tex`, block 1: academic supervisor, full school name, university, internship dates.
2. Everything in **red brackets** in the PDF is a placeholder (`\afaire{...}`): company presentation (ch. 1),
   hardware (ch. 4), resource usage table (ch. 5, `docker stats`), personal skills (conclusion), dedication.
3. Screenshots: see `CAPTURES.md`. Logos: `figures/logos/`.
4. When done, in `main.tex` change `\brouillontrue` to `\brouillonfalse`
   (removes the red markers; missing screenshots still show their box).

## Layout
`config/` (preamble, cover page) - `chapitres/` - `annexes/` - `figures/` (tikz, diagrammes = vector PDFs,
src = Mermaid sources, captures, logos) - `bibliographie.bib`.
