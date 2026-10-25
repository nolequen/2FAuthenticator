<template>
  <div class="import_file">
    <label for="import_file">{{ label }}</label>
    <input
      id="import_file"
      type="file"
      :accept="accept"
      :multiple="multiple"
      @change="emit('change', $event)"
    />
  </div>
</template>
<script setup lang="ts">
defineProps<{ label?: string; multiple?: boolean; accept?: string }>();
const emit = defineEmits<{ change: [event: Event] }>();
</script>
