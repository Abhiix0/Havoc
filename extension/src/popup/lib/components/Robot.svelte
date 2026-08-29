<script lang="ts">
  export let state:
    | 'idle'
    | 'ready'
    | 'armed'
    | 'running'
    | 'chaos'
    | 'recovering'
    | 'success'
    | 'failure' = 'idle';

  $: isAnimated = state === 'idle' || state === 'ready';
  $: eyeColor =
    state === 'chaos' || state === 'failure'
      ? 'var(--havoc-red, #E85C4A)'
      : state === 'recovering' || state === 'ready'
      ? 'var(--warn-amber, #F5C451)'
      : state === 'success'
      ? 'var(--recover-green, #4ADE80)'
      : 'var(--info-blue, #5B8FD8)';

  $: antennaColor =
    state === 'chaos' || state === 'armed'
      ? 'var(--havoc-red, #E85C4A)'
      : state === 'running'
      ? 'var(--warn-amber, #F5C451)'
      : 'var(--text-muted, #8A8B90)';
</script>

<div class="robot-wrap robot-{state}" class:animated={isAnimated}>
  <svg
    width="96"
    height="108"
    viewBox="0 0 96 108"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    class="robot-svg"
  >
    <!-- Shadow -->
    <ellipse cx="48" cy="100" rx="28" ry="4" fill="rgba(0, 0, 0, 0.4)" />

    <!-- Robot Rig for Breathing -->
    <g class="robot-rig">
      <!-- Antenna -->
      <line x1="48" y1="12" x2="48" y2="24" stroke="#3A3C45" stroke-width="3" stroke-linecap="round" />
      <circle cx="48" cy="10" r="5" fill={antennaColor} class="antenna-bulb" />
      <circle cx="48" cy="10" r="2" fill="#FFFFFF" opacity="0.7" />

      <!-- Head Chassis -->
      <rect x="24" y="24" width="48" height="34" rx="6" fill="#22242B" stroke="#3A3C45" stroke-width="2" />
      <!-- Screws -->
      <circle cx="28" cy="28" r="1.5" fill="#3A3C45" />
      <circle cx="68" cy="28" r="1.5" fill="#3A3C45" />

      <!-- Visor Screen -->
      <rect x="29" y="31" width="38" height="20" rx="3" fill="#0C0D0F" stroke="#1E2026" stroke-width="1.5" />

      <!-- Eyes Group for Blinking -->
      <g class="robot-eyes" style="transform-origin: 48px 41px;">
        <rect x="35" y="37" width="8" height="8" rx="2" fill={eyeColor} />
        <rect x="53" y="37" width="8" height="8" rx="2" fill={eyeColor} />
        <!-- Eye glints -->
        <rect x="36" y="38" width="2.5" height="2.5" rx="0.5" fill="#FFFFFF" opacity="0.8" />
        <rect x="54" y="38" width="2.5" height="2.5" rx="0.5" fill="#FFFFFF" opacity="0.8" />
      </g>

      <!-- Neck Joint -->
      <rect x="42" y="58" width="12" height="4" rx="1" fill="#18191E" />

      <!-- Body / Torso Chassis -->
      <rect x="28" y="62" width="40" height="26" rx="4" fill="#22242B" stroke="#3A3C45" stroke-width="2" />

      <!-- Chest Core / Diagnostic Plate -->
      <rect x="34" y="68" width="28" height="14" rx="2" fill="#16171D" stroke="#2B2D36" stroke-width="1" />
      <line x1="38" y1="72" x2="58" y2="72" stroke="#3A3C45" stroke-width="1.5" stroke-linecap="round" />
      <line x1="38" y1="76" x2="52" y2="76" stroke="#3A3C45" stroke-width="1.5" stroke-linecap="round" />
      <circle cx="56" cy="76" r="1.5" fill="var(--havoc-red, #E85C4A)" />

      <!-- Left Arm -->
      <g class="robot-arm-left">
        <rect x="18" y="65" width="8" height="18" rx="3" fill="#1C1D24" stroke="#3A3C45" stroke-width="1.5" />
        <rect x="19" y="80" width="6" height="5" rx="1" fill="#2B2D36" />
      </g>

      <!-- Right Arm -->
      <g class="robot-arm-right">
        <rect x="70" y="65" width="8" height="18" rx="3" fill="#1C1D24" stroke="#3A3C45" stroke-width="1.5" />
        <rect x="71" y="80" width="6" height="5" rx="1" fill="#2B2D36" />
      </g>

      <!-- Treads / Base -->
      <rect x="26" y="88" width="44" height="10" rx="3" fill="#16171D" stroke="#3A3C45" stroke-width="2" />
      <!-- Tread ribs -->
      <line x1="34" y1="89" x2="34" y2="97" stroke="#2B2D36" stroke-width="2" />
      <line x1="43" y1="89" x2="43" y2="97" stroke="#2B2D36" stroke-width="2" />
      <line x1="53" y1="89" x2="53" y2="97" stroke="#2B2D36" stroke-width="2" />
      <line x1="62" y1="89" x2="62" y2="97" stroke="#2B2D36" stroke-width="2" />
    </g>
  </svg>
</div>

<style>
  .robot-wrap {
    display: flex;
    align-items: center;
    justify-content: center;
    user-select: none;
  }

  .robot-svg {
    display: block;
    overflow: visible;
  }

  .animated .robot-rig {
    animation: robot-breathe 4s ease-in-out infinite;
    transform-origin: 48px 94px;
  }

  .animated .robot-eyes {
    animation: robot-blink 4.8s infinite;
  }

  @keyframes robot-breathe {
    0%,
    100% {
      transform: translateY(0) scale(1);
    }
    50% {
      transform: translateY(-2px) scale(1.02);
    }
  }

  @keyframes robot-blink {
    0%,
    92%,
    100% {
      transform: scaleY(1);
    }
    95% {
      transform: scaleY(0.1);
    }
  }
</style>
