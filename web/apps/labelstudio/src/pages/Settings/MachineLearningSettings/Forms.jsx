import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@humansignal/ui";
import { ErrorWrapper } from "../../../components/Error/Error";
import { InlineError } from "../../../components/Error/InlineError";
import { Form, Input, Select, TextArea, Toggle } from "../../../components/Form";
import "./MachineLearningSettings.scss";

const CustomBackendForm = ({ action, backend, project, onSubmit }) => {
  const { t } = useTranslation();
  const [selectedAuthMethod, setAuthMethod] = useState("NONE");
  const [, setMLError] = useState();

  return (
    <Form
      action={action}
      formData={{ ...(backend ?? {}) }}
      params={{ pk: backend?.id }}
      onSubmit={async (response) => {
        if (!response.error_message) {
          onSubmit(response);
        }
      }}
    >
      <Input type="hidden" name="project" value={project.id} />

      <Form.Row columnCount={1}>
        <Input name="title" label={t("Name")} placeholder={t("Enter a name")} required />
      </Form.Row>

      <Form.Row columnCount={1}>
        <Input name="url" label={t("Backend URL")} required />
      </Form.Row>

      <Form.Row columnCount={2}>
        <Select
          name="auth_method"
          label={t("Select authentication method")}
          options={[
            { label: t("No Authentication"), value: "NONE" },
            { label: t("Basic Authentication"), value: "BASIC_AUTH" },
          ]}
          value={selectedAuthMethod}
          onChange={setAuthMethod}
        />
      </Form.Row>

      {(backend?.auth_method === "BASIC_AUTH" || selectedAuthMethod === "BASIC_AUTH") && (
        <Form.Row columnCount={2}>
          <Input name="basic_auth_user" label={t("Basic auth user")} />
          {backend?.basic_auth_pass_is_set ? (
            <Input name="basic_auth_pass" label={t("Basic auth pass")} type="password" placeholder="********" />
          ) : (
            <Input name="basic_auth_pass" label={t("Basic auth pass")} type="password" />
          )}
        </Form.Row>
      )}

      <Form.Row columnCount={1}>
        <TextArea
          name="extra_params"
          label={t("Any extra params to pass during model connection")}
          style={{ minHeight: 120 }}
        />
      </Form.Row>

      <Form.Row columnCount={1}>
        <Toggle
          name="is_interactive"
          label={t("Interactive preannotations")}
          description={t(
            "If enabled some labeling tools will send requests to the ML Backend interactively during the annotation process.",
          )}
        />
      </Form.Row>

      <Form.Actions>
        <Button type="submit" look="primary" onClick={() => setMLError(null)} aria-label={t("Validate ML backend form")}>
          {t("Validate and Save")}
        </Button>
      </Form.Actions>

      <Form.ResponseParser>
        {(response) => (
          <>
            {response.error_message && (
              <ErrorWrapper
                error={{
                  response: {
                    detail:
                      backend ? t("Failed to save ML backend.") : t("Failed to add new ML backend."),
                    exc_info: response.error_message,
                  },
                }}
              />
            )}
          </>
        )}
      </Form.ResponseParser>

      <InlineError />
    </Form>
  );
};

export { CustomBackendForm };
