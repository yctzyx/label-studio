import { FilterDropdown } from "../FilterDropdown";

export const BooleanFilter = [
  {
    key: "equal",
    label: "为",
    valueType: "single",
    input: (props) => (
      <FilterDropdown
        defaultValue={props.value ?? false}
        onChange={(value) => props.onChange(value)}
        items={[
          { value: true, label: "是" },
          { value: false, label: "否" },
        ]}
        disabled={props.disabled}
      />
    ),
  },
];
