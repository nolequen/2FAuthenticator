<template>
  <div class="control-group">
    <label class="combo-label">{{ label }}</label>
    <input
      class="checkbox"
      type="checkbox"
      :checked="model"
      @change="change($event)"
    />
  </div>
</template>
<script setup lang="ts">
defineProps<{ label?: string }>();
const model = defineModel<boolean>();
const emit = defineEmits<{ change: [checked: boolean] }>();

function change(event: Event) {
  const checked = (event.target as HTMLInputElement).checked;
  model.value = checked;
  emit("change", checked);
}
</script>
