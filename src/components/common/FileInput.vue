<template>
  <label class="dropzone">
    <span class="dropzone-icon"><IconUpload /></span>
    <span class="dropzone-title">{{ label }}</span>
    <span v-if="description" class="dropzone-text">{{ description }}</span>
    <span class="button primary small">{{ button }}</span>
    <input
      class="dropzone-input"
      type="file"
      :accept="accept"
      :multiple="multiple"
      @change="emit('change', $event)"
    />
  </label>
</template>
<script setup lang="ts">
import IconUpload from "lucide-static/icons/upload.svg";

defineProps<{
  label?: string;
  description?: string;
  button?: string;
  multiple?: boolean;
  accept?: string;
}>();
const emit = defineEmits<{ change: [event: Event] }>();
</script>
