# Editor motion source

`editorMotion.css` adapts the fadeIn, fadeInUp, fadeInRight and zoomIn
keyframes from the local Animate.css 4.1.1 snapshot supplied by the owner:
`D:/github/ikame-playable-ads/library/playable/animation/animate-css-4.1.1/animate.min.css`.

- Original package: `animate.css@4.1.1`.
- Source file SHA-256:
  `5fbaeb9f8e25d7e0143bae61d4b1802c16ce7390b96ceb2d498b0d96ff4c853f`.
- Original license is retained byte-for-byte in
  `frontend/public/licenses/animate-css-4.1.1.txt`, shipped with the built app.
- Changes: namespaced keyframes, 8/12 px travel instead of 100%, zoom from
  0.985 instead of 0.3, individual `translate`/`scale` properties, and opt-in
  reduced-motion rules. The palette uses opacity only to keep its existing
  centering transform exact throughout the animation.
- Only this small CSS subset ships. The source folder is not a runtime dependency.
  No AutoAnimate, Motion JS or GSAP code is copied or loaded.

Entrance animations finish in 140–220 ms with no persistent fill mode.
Closing unmounts immediately. Toolbar hover/press feedback only affects enabled
buttons. OS reduced-motion changes apply live through media queries.
