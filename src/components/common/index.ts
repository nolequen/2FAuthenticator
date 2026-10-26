import ButtonInput from "./ButtonInput.vue";
import ButtonLink from "./ButtonLink.vue";
import TextInput from "./TextInput.vue";
import SelectInput from "./SelectInput.vue";
import ToggleInput from "./ToggleInput.vue";
import FileInput from "./FileInput.vue";
import SegmentedInput from "./SegmentedInput.vue";
import PageHeader from "./PageHeader.vue";

export default [
  { name: "a-button", component: ButtonInput },
  { name: "a-button-link", component: ButtonLink },
  { name: "a-text-input", component: TextInput },
  { name: "a-select-input", component: SelectInput },
  { name: "a-toggle-input", component: ToggleInput },
  { name: "a-file-input", component: FileInput },
  { name: "a-segmented-input", component: SegmentedInput },
  { name: "a-page-header", component: PageHeader },
];
