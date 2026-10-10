import { useRouter } from "next/navigation";

import { ResponsiveDialog } from "@/components/responsive-dialog";

import { PrescriptionForm } from "./prescription-form";

interface NewPrescriptionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultPatientId?: string;
};

export const NewPrescriptionDialog = ({
  open,
  onOpenChange,
  defaultPatientId,
}: NewPrescriptionDialogProps) => {
  const router = useRouter();

  return (
    <ResponsiveDialog
      title="New Prescription"
      description="Prescribe an exercise the coach will guide"
      open={open}
      onOpenChange={onOpenChange}
    >
      <PrescriptionForm
        defaultPatientId={defaultPatientId}
        onSuccess={(id) => {
          onOpenChange(false);
          router.push(`/prescriptions/${id}`);
        }}
        onCancel={() => onOpenChange(false)}
      />
    </ResponsiveDialog>
  );
};
