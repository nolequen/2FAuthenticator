<template>
  <a
    :href="href"
    :download="download"
    :class="{ 'button-small': type === 'small', button: !type }"
    target="_blank"
  >
    <slot></slot>
  </a>
</template>
<script setup lang="ts">
defineProps<{ type?: string; href?: string; download?: string }>();
</script>
