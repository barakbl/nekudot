# Onboarding sample artworks

Drop `.nekudot` files here (saved from the app via the Save menu) and they are
**automatically** offered on the Start page as "Open a saved piece" cards - no
config needed. They're bundled at build time and loaded through the normal
artwork loader.

- The file name (without extension) becomes the card title.
- Remove a file to remove its card.

The Start page's main option grid (Mandala / Blank / …) is configured separately
in `../settings.json`.
