import { ResponsiveDialog } from "@/components/responsive-dialog";

import { PrescriptionForm } from "./prescription-form";
import { PrescriptionGetOne } from "../../types";

interface UpdatePrescriptionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialValues: PrescriptionGetOne;
};

export const UpdatePrescriptionDialog = ({
  open,
  onOpenChange,
  initialValues,
}: UpdatePrescriptionDialogProps) => {
  return (
    <ResponsiveDialog
      title="Edit Prescription"
      description="Edit the prescription"
      open={open}
      onOpenChange={onOpenChange}
    >
      <PrescriptionForm
        onSuccess={() => onOpenChange(false)}
        onCancel={() => onOpenChange(false)}
        initialValues={initialValues}
      />
    </ResponsiveDialog>
  );
};
