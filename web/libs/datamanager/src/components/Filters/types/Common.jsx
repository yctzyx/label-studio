import { FilterDropdown } from "../FilterDropdown";

export const Common = [
  {
    key: "empty",
    label: "为空",
    input: (props) => (
      <FilterDropdown
        value={props.value ?? false}
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
