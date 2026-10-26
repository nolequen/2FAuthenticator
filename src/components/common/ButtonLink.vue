<template>
  <a
    :href="href"
    :download="download"
    :class="['button', variant ?? 'secondary', { small, block }]"
    target="_blank"
  >
    <slot></slot>
  </a>
</template>
<script setup lang="ts">
defineProps<{
  variant?: "primary" | "secondary";
  small?: boolean;
  block?: boolean;
  href?: string;
  download?: string;
}>();
</script>
