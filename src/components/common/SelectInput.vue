<template>
  <div class="field">
    <label class="field-label" :for="id">{{ label }}</label>
    <select
      :id="id"
      class="input"
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
import { useId } from "vue";

defineProps<{ label?: string; disabled?: boolean }>();
const model = defineModel<string | number>();
const emit = defineEmits<{ change: [] }>();
const id = useId();
</script>
