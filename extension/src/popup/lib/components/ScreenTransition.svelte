<script lang="ts">
  import { fade } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
</script>

<div
  class="screen-transition-wrap"
  in:fade={{ duration: 200, easing: cubicOut }}
  out:fade={{ duration: 150, easing: cubicOut }}
>
  <slot />
</div>

<style>
  .screen-transition-wrap {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    flex: 1;
  }
</style>
