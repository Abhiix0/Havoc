<script lang="ts">
  export let fixPrompt: string;

  let copied = false;
  let copyTimeout: ReturnType<typeof setTimeout> | null = null;

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(fixPrompt);
      copied = true;
      if (copyTimeout) clearTimeout(copyTimeout);
      copyTimeout = setTimeout(() => {
        copied = false;
      }, 1500);
    } catch (err: unknown) {
      console.error('[HAVOC][FixPromptBox] failed to copy to clipboard', err);
    }
  }
</script>

<div class="fix-prompt-container">
  <div class="fix-prompt-header">
    <span class="fix-prompt-label">AI FIX PROMPT</span>
    <button
      type="button"
      class="copy-btn"
      class:copied
      on:click={handleCopy}
    >
      {#if copied}
        ✓ Copied!
      {:else}
        Copy prompt
      {/if}
    </button>
  </div>
  <pre class="fix-prompt-content">{fixPrompt}</pre>
</div>

<style>
  .fix-prompt-container {
    background: var(--bg-surface-2, #1E1F23);
    border: 1px solid var(--border, #2A2B30);
    border-radius: var(--radius-sm, 4px);
    overflow: hidden;
    margin-top: 6px;
    font-family: var(--font-ui, 'Inter', system-ui, sans-serif);
  }

  .fix-prompt-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px;
    background: rgba(0, 0, 0, 0.25);
    border-bottom: 1px solid var(--border, #2A2B30);
  }

  .fix-prompt-label {
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.5px;
    color: var(--text-muted, #8A8B90);
  }

  .copy-btn {
    background: transparent;
    border: 1px solid var(--border, #2A2B30);
    color: var(--text-primary, #F2F2F0);
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: 9px;
    padding: 2px 8px;
    border-radius: var(--radius-sm, 4px);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .copy-btn:hover {
    background: var(--bg-surface, #16171A);
    border-color: var(--border-hover, #3E4048);
  }

  .copy-btn.copied {
    background: rgba(80, 200, 120, 0.15);
    color: #50C878;
    border-color: rgba(80, 200, 120, 0.4);
  }

  .fix-prompt-content {
    margin: 0;
    padding: 10px;
    font-family: var(--font-mono, 'JetBrains Mono', Consolas, monospace);
    font-size: 10px;
    line-height: 1.45;
    color: var(--text-primary, #F2F2F0);
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 220px;
    overflow-y: auto;
  }
</style>
