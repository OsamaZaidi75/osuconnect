/**
 * The backdrop behind the glass theme: a dusk sky fading from deep indigo to a
 * violet-pink glow, with three layers of mountains. Original artwork drawn
 * here as an SVG data URI, so there is no image to download, host or license.
 */

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMax slice">
<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#0f0a26"/>
<stop offset="0.38" stop-color="#241150"/>
<stop offset="0.66" stop-color="#5a2a8c"/>
<stop offset="0.86" stop-color="#a24a9c"/>
<stop offset="1" stop-color="#e58bb5"/>
</linearGradient>
<radialGradient id="glow" cx="0.62" cy="0.78" r="0.55">
<stop offset="0" stop-color="#ffb4d6" stop-opacity="0.55"/>
<stop offset="1" stop-color="#ffb4d6" stop-opacity="0"/>
</radialGradient>
<linearGradient id="haze" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#8a4fc0" stop-opacity="0"/>
<stop offset="1" stop-color="#8a4fc0" stop-opacity="0.55"/>
</linearGradient>
</defs>
<rect width="1600" height="900" fill="url(#sky)"/>
<rect width="1600" height="900" fill="url(#glow)"/>
<g fill="#ffffff" fill-opacity="0.7">
<circle cx="140" cy="90" r="1.6"/><circle cx="310" cy="150" r="1.2"/><circle cx="520" cy="60" r="1.8"/>
<circle cx="700" cy="130" r="1.1"/><circle cx="880" cy="70" r="1.5"/><circle cx="1060" cy="170" r="1.2"/>
<circle cx="1230" cy="85" r="1.8"/><circle cx="1400" cy="140" r="1.3"/><circle cx="1520" cy="55" r="1.5"/>
<circle cx="230" cy="250" r="1"/><circle cx="960" cy="240" r="1"/><circle cx="1340" cy="260" r="1.1"/>
</g>
<path d="M0 640 L150 520 L260 590 L420 430 L560 560 L700 480 L860 610 L1000 470 L1140 590 L1300 450 L1450 560 L1600 500 L1600 900 L0 900 Z" fill="#6b3b9e" fill-opacity="0.75"/>
<path d="M420 430 L470 500 L440 490 L420 520 L395 490 L372 505 Z" fill="#f3d9ff" fill-opacity="0.55"/>
<path d="M1300 450 L1345 515 L1318 508 L1300 535 L1280 508 L1255 520 Z" fill="#f3d9ff" fill-opacity="0.5"/>
<rect y="520" width="1600" height="380" fill="url(#haze)"/>
<path d="M0 720 L120 640 L260 700 L400 590 L560 690 L720 620 L880 710 L1040 600 L1200 700 L1360 620 L1500 690 L1600 650 L1600 900 L0 900 Z" fill="#3a1c6c" fill-opacity="0.92"/>
<path d="M0 800 L140 740 L300 790 L470 720 L640 790 L820 730 L1000 800 L1180 735 L1360 795 L1500 750 L1600 780 L1600 900 L0 900 Z" fill="#1c0e3e"/>
</svg>`;

export const glassWallpaper = `url("data:image/svg+xml,${encodeURIComponent(SVG)}")`;
