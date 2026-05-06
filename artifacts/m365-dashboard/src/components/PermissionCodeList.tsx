import React from "react";

export function PermissionCodeList({
  permissions,
  codeClassName,
  conjunction = "and",
}: {
  permissions: string[];
  codeClassName: string;
  conjunction?: "and" | "or";
}) {
  return permissions.map((permission, index) => {
    const isLast = index === permissions.length - 1;
    const isPenultimate = index === permissions.length - 2;

    return (
      <React.Fragment key={permission}>
        <code className={codeClassName}>{permission}</code>
        {!isLast ? permissions.length === 2 || isPenultimate ? ` ${conjunction} ` : ", " : null}
      </React.Fragment>
    );
  });
}