import { observer } from "mobx-react";
import { FilterInput } from "../FilterInput";

const BaseInput = observer(({ value, onChange, placeholder }) => {
  return <FilterInput type="text" value={value} onChange={onChange} placeholder={placeholder} />;
});

export const StringFilter = [
  {
    key: "contains",
    label: "包含",
    valueType: "single",
    input: (props) => <BaseInput {...props} />,
  },
  {
    key: "not_contains",
    label: "不包含",
    valueType: "single",
    input: (props) => <BaseInput {...props} />,
  },
  {
    key: "regex",
    label: "正则匹配",
    valueType: "single",
    input: (props) => <BaseInput {...props} />,
  },
  {
    key: "equal",
    label: "等于",
    valueType: "single",
    input: (props) => <BaseInput {...props} />,
  },
  {
    key: "not_equal",
    label: "不等于",
    valueType: "single",
    input: (props) => <BaseInput {...props} />,
  },
];
