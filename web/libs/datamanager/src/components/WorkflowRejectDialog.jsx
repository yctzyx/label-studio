import { useState } from "react";
import { Button } from "@humansignal/ui";
import { Modal } from "../components/Common/Modal/Modal";

const MAX_LENGTH = 500;

function RejectReasonForm({ initialValue = "", onValueChange, error }) {
  const [value, setValue] = useState(initialValue);

  const handleChange = (e) => {
    const next = e.target.value.slice(0, MAX_LENGTH);
    setValue(next);
    onValueChange(next);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 360 }}>
      <label htmlFor="workflow-reject-reason" style={{ fontSize: 14, color: "#606266" }}>
        请说明驳回原因，标注员将在「我的任务」中看到此备注。
      </label>
      <textarea
        id="workflow-reject-reason"
        rows={4}
        value={value}
        onChange={handleChange}
        placeholder="例如：漏标电焊区域、类别错误需修改…"
        style={{
          width: "100%",
          padding: "8px 10px",
          fontSize: 14,
          borderRadius: 6,
          border: error ? "1px solid #f56c6c" : "1px solid #dcdfe6",
          resize: "vertical",
          boxSizing: "border-box",
        }}
        autoFocus
      />
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#909399" }}>
        <span style={{ color: error ? "#f56c6c" : undefined }}>{error || " "}</span>
        <span>
          {value.length}/{MAX_LENGTH}
        </span>
      </div>
    </div>
  );
}

/**
 * Workflow reject comment prompt. Resolves with trimmed comment or null if cancelled.
 */
export function promptWorkflowRejectComment({ title = "填写驳回原因", initialValue = "" } = {}) {
  return new Promise((resolve) => {
    const state = { comment: initialValue, error: "" };
    const modalRef = { current: null };

    const renderBody = () => (
      <RejectReasonForm
        initialValue={state.comment}
        error={state.error}
        onValueChange={(v) => {
          state.comment = v;
          if (state.error && v.trim()) {
            state.error = "";
            modalRef.current?.update({ body: renderBody() });
          }
        }}
      />
    );

    const footer = (
      <div className="flex gap-2 justify-end">
        <Button
          look="outlined"
          variant="neutral"
          onClick={() => {
            modalRef.current?.close();
            resolve(null);
          }}
        >
          取消
        </Button>
        <Button
          variant="negative"
          onClick={() => {
            const trimmed = state.comment.trim();
            if (!trimmed) {
              state.error = "请填写驳回原因";
              modalRef.current?.update({ body: renderBody() });
              return;
            }
            modalRef.current?.close();
            resolve(trimmed);
          }}
        >
          确认驳回
        </Button>
      </div>
    );

    modalRef.current = Modal.modal({
      title,
      simple: true,
      allowClose: true,
      body: renderBody(),
      footer,
      onHidden: () => resolve(null),
    });
  });
}
