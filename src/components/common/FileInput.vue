<template>
  <div class="import_file">
    <label for="import_file">{{ label }}</label>
    <input
      id="import_file"
      type="file"
      @change="emit('change', $event)"
      :accept="accept"
      :multiple="multiple"
    />
  </div>
</template>
<script setup lang="ts">
defineProps<{ label?: string; multiple?: boolean; accept?: string }>();
const emit = defineEmits<{ change: [event: Event] }>();
</script>
