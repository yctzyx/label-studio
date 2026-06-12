import argparse
import json
import logging
import logging.config
import os

logging.config.dictConfig({
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "standard": {
            "format": "[%(asctime)s] [%(levelname)s] [%(name)s::%(funcName)s::%(lineno)d] %(message)s"
        }
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "level": os.getenv("LOG_LEVEL", "INFO"),
            "stream": "ext://sys.stdout",
            "formatter": "standard",
        }
    },
    "root": {
        "level": os.getenv("LOG_LEVEL", "INFO"),
        "handlers": ["console"],
        "propagate": True,
    },
})

from label_studio_ml.api import init_app
from label_studio_ml.model import LabelStudioMLBase

from dino import GroundingDINO
from log_utils import install_safe_logging

install_safe_logging()


def _patch_set_extra_params():
    """CACHE only accepts strings; Label Studio /setup can pass dict extra_params."""

    def set_extra_params(self, extra_params):
        if extra_params is None:
            return
        if not isinstance(extra_params, str):
            extra_params = json.dumps(extra_params, ensure_ascii=False)
        self.set("extra_params", extra_params)

    LabelStudioMLBase.set_extra_params = set_extra_params


_patch_set_extra_params()

_DEFAULT_CONFIG_PATH = os.path.join(os.path.dirname(__file__), "config.json")


def get_kwargs_from_config(config_path=_DEFAULT_CONFIG_PATH):
    if not os.path.exists(config_path):
        return {}
    with open(config_path, encoding="utf-8") as f:
        config = json.load(f)
    assert isinstance(config, dict)
    return config


def isfloat(value):
    try:
        float(value)
        return True
    except ValueError:
        return False


def parse_kwargs(pairs):
    params = {}
    for key, value in pairs:
        if value.isdigit():
            params[key] = int(value)
        elif value.lower() == "true":
            params[key] = True
        elif value.lower() == "false":
            params[key] = False
        elif isfloat(value):
            params[key] = float(value)
        else:
            params[key] = value
    return params


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Label Studio Grounding DINO backend")
    parser.add_argument("-p", "--port", dest="port", type=int, default=9090, help="Server port")
    parser.add_argument("--host", dest="host", type=str, default="0.0.0.0", help="Server host")
    parser.add_argument(
        "--kwargs",
        "--with",
        dest="kwargs",
        metavar="KEY=VAL",
        nargs="+",
        type=lambda kv: kv.split("=", 1),
        help="Additional LabelStudioMLBase model initialization kwargs",
    )
    parser.add_argument("-d", "--debug", dest="debug", action="store_true", help="Switch debug mode")
    parser.add_argument(
        "--log-level",
        dest="log_level",
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
        default=None,
        help="Logging level",
    )
    parser.add_argument(
        "--model-dir",
        dest="model_dir",
        default=os.path.dirname(__file__),
        help="Directory where models are stored",
    )
    parser.add_argument("--check", dest="check", action="store_true", help="Validate model instance before launching server")
    parser.add_argument(
        "--basic-auth-user",
        default=os.environ.get("ML_SERVER_BASIC_AUTH_USER"),
        help="Basic auth user",
    )
    parser.add_argument(
        "--basic-auth-pass",
        default=os.environ.get("ML_SERVER_BASIC_AUTH_PASS"),
        help="Basic auth pass",
    )

    args = parser.parse_args()

    if args.log_level:
        logging.root.setLevel(args.log_level)

    kwargs = get_kwargs_from_config()
    if args.kwargs:
        kwargs.update(parse_kwargs(args.kwargs))

    if args.check:
        print(f'Check "{GroundingDINO.__name__}" instance creation..')
        GroundingDINO(**kwargs)

    app = init_app(
        model_class=GroundingDINO,
        basic_auth_user=args.basic_auth_user,
        basic_auth_pass=args.basic_auth_pass,
    )
    app.run(host=args.host, port=args.port, debug=args.debug)
else:
    app = init_app(model_class=GroundingDINO)
