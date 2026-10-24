<template>
  <div class="control-group">
    <label class="combo-label" style="margin: 20px 10px">{{ label }}</label>
    <select
      style="margin: 20px 10px"
      :value="model"
      :disabled="disabled"
      @input="model = ($event.target as HTMLSelectElement).value"
      @change="emit('change')"
    >
      <slot></slot>
    </select>
  </div>
</template>
<script setup lang="ts">
defineProps<{ label?: string; disabled?: boolean }>();
const model = defineModel<string | number>();
const emit = defineEmits<{ change: [] }>();
</script>
