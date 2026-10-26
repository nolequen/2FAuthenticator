import ButtonInput from "../components/common/ButtonInput.vue";
import ButtonLink from "../components/common/ButtonLink.vue";
import FileInput from "../components/common/FileInput.vue";
import PageHeader from "../components/common/PageHeader.vue";
import SegmentedInput from "../components/common/SegmentedInput.vue";
import SelectInput from "../components/common/SelectInput.vue";
import TextInput from "../components/common/TextInput.vue";
import ToggleInput from "../components/common/ToggleInput.vue";

declare module "vue" {
  interface ComponentCustomProperties {
    i18n: { [key: string]: string };
  }

  interface GlobalComponents {
    AButton: typeof ButtonInput;
    AButtonLink: typeof ButtonLink;
    ATextInput: typeof TextInput;
    ASelectInput: typeof SelectInput;
    AToggleInput: typeof ToggleInput;
    AFileInput: typeof FileInput;
    ASegmentedInput: typeof SegmentedInput;
    APageHeader: typeof PageHeader;
  }
}
