import pytest
from ml.models import MLBackend
from organizations.models import Organization
from projects.models import Project
from tasks.models import Prediction, Task
from users.models import User

BACKEND_TITLE = 'Grounding DINO 视觉预标注'


@pytest.mark.django_db
def test_get_predictions_for_prelabeling_uses_project_model_version_when_setup_empty(mocker):
    user = User.objects.create(email='prelabel@test.com')
    org = Organization.create_organization(created_by=user, title='org')
    project = Project.objects.create(
        title='fire-detection',
        created_by=user,
        organization=org,
        show_collab_predictions=True,
        model_version=BACKEND_TITLE,
        label_config='<View></View>',
    )
    MLBackend.objects.create(
        project=project,
        url='http://localhost:9092',
        title=BACKEND_TITLE,
        model_version='',
    )
    task = Task.objects.create(project=project, data={'image': 'test.jpg'})
    Prediction.objects.create(task=task, project=project, model_version=BACKEND_TITLE, result=[])

    mocker.patch('data_manager.functions.evaluate_predictions', return_value='')

    predictions = task.get_predictions_for_prelabeling()
    assert predictions.count() == 1
    assert predictions.first().model_version == BACKEND_TITLE


@pytest.mark.django_db
def test_get_predictions_for_prelabeling_when_ml_unavailable(mocker):
    user = User.objects.create(email='prelabel2@test.com')
    org = Organization.create_organization(created_by=user, title='org2')
    project = Project.objects.create(
        title='fire-detection-2',
        created_by=user,
        organization=org,
        show_collab_predictions=True,
        model_version=BACKEND_TITLE,
        label_config='<View></View>',
    )
    MLBackend.objects.create(project=project, url='http://localhost:9092', title=BACKEND_TITLE)
    task = Task.objects.create(project=project, data={'image': 'test.jpg'})
    Prediction.objects.create(task=task, project=project, model_version=BACKEND_TITLE, result=[])

    mocker.patch('data_manager.functions.evaluate_predictions', return_value=None)

    predictions = task.get_predictions_for_prelabeling()
    assert predictions.count() == 1
