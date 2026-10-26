<template>
  <label :class="['switch-row', { centered: !description }]">
    <slot name="icon"></slot>
    <span class="switch-text">
      <span class="switch-title">{{ label }}</span>
      <span v-if="description" class="switch-description">{{
        description
      }}</span>
    </span>
    <input
      class="visually-hidden"
      type="checkbox"
      role="switch"
      :checked="model"
      :disabled="disabled"
      @change="change($event)"
    />
    <span class="switch" aria-hidden="true"></span>
  </label>
</template>
<script setup lang="ts">
defineProps<{ label?: string; description?: string; disabled?: boolean }>();
const model = defineModel<boolean>();
const emit = defineEmits<{ change: [checked: boolean] }>();

function change(event: Event) {
  const checked = (event.target as HTMLInputElement).checked;
  model.value = checked;
  emit("change", checked);
}
</script>
