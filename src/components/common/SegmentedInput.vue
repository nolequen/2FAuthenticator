<template>
  <fieldset class="segmented-field">
    <legend :class="labelHidden ? 'visually-hidden' : 'field-label'">
      {{ label }}
    </legend>
    <div class="segmented">
      <label v-for="option in options" :key="option.value">
        <input
          class="visually-hidden"
          type="radio"
          :name="name"
          :value="option.value"
          :checked="model === option.value"
          @change="model = option.value"
        />
        <span>{{ option.label }}</span>
      </label>
    </div>
  </fieldset>
</template>
<script setup lang="ts" generic="T extends string | number">
import { useId } from "vue";

defineProps<{
  label: string;
  labelHidden?: boolean;
  options: { value: T; label: string }[];
}>();
const model = defineModel<T>();
const name = useId();
</script>
