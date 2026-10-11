import { ResponsiveDialog } from "@/components/responsive-dialog";

import { PatientForm } from "./patient-form";
import { PatientGetOne } from "../../types";

interface UpdatePatientDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialValues: PatientGetOne;
};

export const UpdatePatientDialog = ({
  open,
  onOpenChange,
  initialValues,
}: UpdatePatientDialogProps) => {
  return (
    <ResponsiveDialog
      title="Edit patient"
      description="Update contact details and the language the coach uses."
      open={open}
      onOpenChange={onOpenChange}
    >
      <PatientForm
        onSuccess={() => onOpenChange(false)}
        onCancel={() => onOpenChange(false)}
        initialValues={initialValues}
      />
    </ResponsiveDialog>
  );
};
