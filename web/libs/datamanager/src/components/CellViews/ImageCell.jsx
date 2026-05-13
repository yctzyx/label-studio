import { getRoot } from "mobx-state-tree";
import { AnnotationPreview } from "../Common/AnnotationPreview/AnnotationPreview";
import { AuthImage } from "../Common/AuthImage/AuthImage";
import { absoluteURL } from "../../utils/helpers";

const imgDefaultProps = { crossOrigin: "anonymous" };

export const ImageCell = (column) => {
  const {
    original,
    value,
    column: { alias },
  } = column;
  const root = getRoot(original);

  const renderImagePreview = original.total_annotations === 0 || !root.showPreviews;
  const rawSrc = Array.isArray(value) ? value[0] : value;
  const imgSrc = rawSrc ? absoluteURL(rawSrc) : null;

  if (!imgSrc) return null;

  return renderImagePreview ? (
    <AuthImage
      {...imgDefaultProps}
      key={imgSrc}
      src={imgSrc}
      alt="Data"
      style={{
        maxHeight: "100%",
        maxWidth: "100px",
        objectFit: "contain",
        borderRadius: 3,
      }}
    />
  ) : (
    <AnnotationPreview
      task={original}
      annotation={original.annotations[0]}
      config={getRoot(original).SDK}
      name={alias}
      variant="120x120"
      fallbackImage={value}
      style={{
        maxHeight: "100%",
        maxWidth: "100px",
        objectFit: "contain",
        borderRadius: 3,
      }}
    />
  );
};
