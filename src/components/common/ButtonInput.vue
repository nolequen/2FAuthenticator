<template>
  <button
    :type="submit ? 'submit' : 'button'"
    :class="['button', variant ?? 'secondary', { small, block }]"
  >
    <slot></slot>
  </button>
</template>
<script setup lang="ts">
defineProps<{
  variant?: "primary" | "secondary" | "danger" | "danger-soft";
  small?: boolean;
  block?: boolean;
  submit?: boolean;
}>();
</script>
