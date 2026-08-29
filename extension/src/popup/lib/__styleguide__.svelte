<script lang="ts">
  import Button from './components/Button.svelte';
  import CapabilityBadge from './components/CapabilityBadge.svelte';
  import TargetCard from './components/TargetCard.svelte';
</script>

<div class="styleguide-container">
  <h2>HAVOC Design System (Phase 1 Styleguide)</h2>

  <section>
    <h3>Buttons</h3>
    <div class="row">
      <Button variant="primary">INITIATE HAVOC</Button>
      <Button variant="ghost">Secondary Action</Button>
      <Button variant="danger">ABORT EXPERIMENT</Button>
      <Button variant="primary" disabled>Disabled State</Button>
    </div>
  </section>

  <section>
    <h3>Capability Badges</h3>
    <div class="row">
      <CapabilityBadge label="Top Level" tone="neutral" />
      <CapabilityBadge label="Fetch Intercept" tone="info" />
      <CapabilityBadge label="Active" tone="success" />
    </div>
  </section>

  <section>
    <h3>Target Card</h3>
    <TargetCard
      origin="https://app.example.com"
      url="https://app.example.com/checkout/order-summary"
      capabilities={[
        { label: 'Top Level', tone: 'neutral' },
        { label: 'Fetch Intercept', tone: 'info' },
        { label: 'DOM Observer', tone: 'success' },
      ]}
    />
  </section>
</div>

<style>
  .styleguide-container {
    padding: var(--space-4, 16px);
    background: var(--bg-base, #0A0A0B);
    color: var(--text-primary, #F2F2F0);
    display: flex;
    flex-direction: column;
    gap: var(--space-4, 16px);
    font-family: var(--font-ui, 'Inter', system-ui, sans-serif);
  }

  h2 {
    font-size: var(--text-lg, 14px);
    margin: 0;
    color: var(--havoc-red, #E85C4A);
  }

  h3 {
    font-size: var(--text-xs, 11px);
    color: var(--text-muted, #8A8B90);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin: 0 0 var(--space-2, 8px) 0;
  }

  .row {
    display: flex;
    gap: var(--space-2, 8px);
    align-items: center;
    flex-wrap: wrap;
  }
</style>
