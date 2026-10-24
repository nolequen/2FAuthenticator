<template>
  <button :class="{ 'button-small': type === 'small', button: !type }">
    <slot></slot>
  </button>
</template>
<script setup lang="ts">
defineProps<{ type?: string }>();
</script>
